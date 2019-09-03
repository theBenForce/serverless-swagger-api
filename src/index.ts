import * as Serverless from "serverless";
import Plugin = require("serverless/classes/Plugin");
import { writeFileSync } from "fs";
import { join } from "path";
import * as AWS from "aws-sdk";

const hash = require("string-hash");

type MethodObject = {
  [key: string]: any;
};

interface APIDefinition {
  Name: string;
  Body: any;
  Stage: string;
}

interface PluginOptions {
  apis: { [key: string]: APIDefinition };
  updateDeployments?: boolean;
  usePackageVersion?: boolean;
}

const MAX_NAME_LENGTH = 64;

function clipString(value: string, postfix: string): string {
  const maxLength = MAX_NAME_LENGTH - 1 - postfix.length;
  if (value.length > maxLength) {
    value = [
      value.substr(0, maxLength - 9),
      hash(value)
        .toString(16)
        .toUpperCase()
    ].join("-");
  }

  return [value, postfix].join("-");
}

export default class SwaggerApiPlugin implements Plugin {
  readonly hooks: { [key: string]: any };
  readonly commands: {
    [key: string]: {
      usage: string;
      lifecycleEvents: Array<string>;
      options: any;
    };
  };
  readonly name: string;

  constructor(private serverless: Serverless, private options: any) {
    this.name = "serverless-swagger-api";

    this.hooks = {
      "before:package:finalize": this.updateApiDefinitions(),
      "after:deploy": () => this.updateApiDeployments(),
      "updateDeployments:update": () => this.updateApiDeployments()
    };

    this.commands = {
      updateDeployments: {
        usage: `Update API Gateway deployments defined with ${this.name}`,
        lifecycleEvents: ["update"],
        options: {
          message: {
            usage: "Specify the message attached to this deployment",
            required: false
          }
        }
      }
    };
  }

  get stackName() {
    return [
      this.serverless.service.getServiceName(),
      this.serverless.getProvider("aws").getStage()
    ].join("-");
  }

  get pluginOptions(): PluginOptions {
    return this.serverless.service.custom.swaggerApi || {};
  }

  get stackApis(): { [key: string]: APIDefinition } {
    return this.pluginOptions.apis || {};
  }

  private async updateApiDeployments() {
    const aws = this.serverless.getProvider("aws");
    const region = aws.getRegion();
    const options = this.pluginOptions;

    if (options.updateDeployments === false) {
      return;
    }

    const cloudFormation = new AWS.CloudFormation({
      region,
      apiVersion: "2010-05-15"
    });

    const apigateway = new AWS.APIGateway({
      region,
      apiVersion: "2015-07-09"
    });

    const stack = await cloudFormation
      .describeStackResources({ StackName: this.stackName })
      .promise();

    const apis = this.stackApis;
    for (const key in apis) {
      try {
        const restApi = apis[key];

        if (options.usePackageVersion) {
          const { version } = require("./package.json");
          restApi.Body.info.version = version;
        }
        const stageName =
          restApi.Stage || this.serverless.service.provider.stage;

        const apiResource = stack.StackResources.find(
          x => x.LogicalResourceId === key
        );
        const restApiId = apiResource.PhysicalResourceId;

        this.serverless.cli.log(
          `Creating new deployment for ${restApiId} api stage ${stageName}...`
        );
        await apigateway
          .createDeployment({
            restApiId,
            stageName,
            description: this.options.message || `${this.name} auto-deployment`
          })
          .promise();
      } catch (ex) {
        this.serverless.cli.log(`Could not update API: ${key}`);
      }
    }
  }

  private updateApiDefinitions() {
    return (() => {
      const apis = this.stackApis;
      for (const key of Object.keys(apis)) {
        this.serverless.cli.log(`Creating ${key} api`);
        const api = apis[key];
        this.createRestApi(key, api);
      }
    }).bind(this);
  }

  private filterMethods(methods: MethodObject): MethodObject {
    const acceptableMethods = [
      "get",
      "post",
      "put",
      "patch",
      "delete",
      "head",
      "options"
    ];

    return Object.keys(methods)
      .filter(method => acceptableMethods.includes(method))
      .reduce((acc, p) => {
        return { ...acc, [p]: methods[p] };
      }, {});
  }

  private createRestApi(key: string, restApi: APIDefinition) {
    const resources = this.serverless.service.provider
      .compiledCloudFormationTemplate.Resources;
    const stage = restApi.Stage || this.serverless.service.provider.stage;
    const service = this.serverless.service.getServiceName();
    const functionNames = [];
    const lambdaPermissions = {};

    for (const path in restApi.Body.paths) {
      this.serverless.cli.log(`Connecting lambda for ${path} on ${key}`);
      const methods = this.filterMethods(restApi.Body.paths[path]);

      for (const method in methods) {
        const methodProps = methods[method];
        const functionName = methodProps["x-lambda-name"];
        functionNames.push(functionName);

        methodProps["x-amazon-apigateway-integration"] = {
          uri: {
            "Fn::Sub": `arn:aws:apigateway:\${AWS::Region}:lambda:path/2015-03-31/functions/\${${functionName}.Arn}/invocations`
          },
          passthroughBehavior: "when_no_match",
          httpMethod: "POST",
          type: "aws_proxy",
          responses: {}
        };

        if (!lambdaPermissions[functionName]) {
          lambdaPermissions[functionName] = [];
        }

        lambdaPermissions[functionName].push(`${method.toUpperCase()}${path}`);
      }
    }

    functionNames.forEach(functionName => {
      const paths = lambdaPermissions[functionName];

      paths.forEach(path => {
        resources[
          `${key}${functionName}${path.replace(/[^A-Za-z0-9]/g, "")}Permission`
        ] = this.createLambdaInvokePermission(functionName, key, path);
      });
    });

    // Create api
    this.createApiResources(
      resources,
      key,
      restApi,
      stage,
      service,
      functionNames
    );
  }
  private createLambdaInvokePermission(
    functionName: any,
    key: string,
    path: any
  ): any {
    this.serverless.cli.log(
      `Creating Lambda Invoke Permission for ${functionName}`
    );

    return {
      Type: "AWS::Lambda::Permission",
      Properties: {
        FunctionName: { "Fn::Sub": `\${${functionName}.Arn}` },
        Action: "lambda:InvokeFunction",
        Principal: { "Fn::Sub": "apigateway.${AWS::URLSuffix}" },
        SourceArn: {
          "Fn::Sub": `arn:aws:execute-api:\${AWS::Region}:\${AWS::AccountId}:\${${key}}/*/${path}`
        }
      }
    };
  }

  private createApiDeploymentName(key: string) {
    return `${key}Deployment`;
  }

  private createApiResources(
    resources: any[],
    key: string,
    restApi: any,
    stage: any,
    service: string,
    functionNames: any[]
  ) {
    this.serverless.cli.log(`Creating API Resource ${key}`);

    resources[key] = this.createApi(restApi);
    resources[this.createApiDeploymentName(key)] = this.createDeployment(
      key,
      stage
    );
    resources[`${key}ServiceRole`] = this.createServiceRole(
      stage,
      service,
      key,
      functionNames
    );
  }

  private createServiceRole(
    stage: any,
    service: string,
    key: string,
    functionNames: any[]
  ): any {
    this.serverless.cli.log(`Creating service role for ${key}`);

    return {
      Type: "AWS::IAM::Role",
      Properties: {
        RoleName: clipString(`${stage}${service}${key}`, "APIRole"),
        AssumeRolePolicyDocument: {
          Version: "2012-10-17",
          Statement: [
            {
              Effect: "Allow",
              Principal: {
                Service: "apigateway.amazonaws.com"
              },
              Action: "sts:AssumeRole"
            }
          ]
        },
        Policies: [
          this.createLambdaExecutionPolicy(stage, service, key, functionNames)
        ]
      }
    };
  }

  private createLambdaExecutionPolicy(
    stage: any,
    service: string,
    key: string,
    functionNames: any[]
  ) {
    this.serverless.cli.log(`Creating lambda execution policy for ${key}`);

    return {
      PolicyName: clipString(`${stage}-${service}-${key}`, `APIPolicy`),
      PolicyDocument: {
        Version: "2012-10-17",
        Statement: functionNames.map(functionName => ({
          Action: "lambda:InvokeFunction",
          Resource: { "Fn::Sub": `\${${functionName}.Arn}` },
          Effect: "Allow"
        }))
      }
    };
  }

  private createDeployment(key: string, stage: any): any {
    this.serverless.cli.log(`Creating API Deployment for ${key}`);

    return {
      Type: "AWS::ApiGateway::Deployment",
      DependsOn: [key],
      Properties: {
        RestApiId: { Ref: key },
        StageName: stage
      }
    };
  }

  private createApi(restApi: any): any {
    this.serverless.cli.log(`Creating RestApi ${restApi.Name}`);

    return {
      Type: "AWS::ApiGateway::RestApi",
      Properties: {
        Name: restApi.Name,
        Body: restApi.Body
      }
    };
  }
}

module.exports = SwaggerApiPlugin;
