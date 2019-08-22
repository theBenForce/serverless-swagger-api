import * as Serverless from "serverless";

export default class SwaggerApiPlugin {
  hooks: { [key: string]: any };
  name: string;

  constructor(serverless: Serverless, options: any) {
    this.name = "serverless-swagger-api";

    this.hooks = {
      "before:package:finalize": () => updateApiDefinitions(serverless)
    };
  }
}

module.exports = SwaggerApiPlugin;

function updateApiDefinitions(serverless: Serverless) {
  const apis = serverless.service.custom.swaggerApi;
  for (const key in apis) {
    const api = apis[key];
    createRestApi(serverless, key, api);
  }
}

type MethodObject = {
  [key: string]: any;
};

function filterMethods(methods: MethodObject): MethodObject {
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

function createRestApi(serverless: Serverless, key: string, restApi: any) {
  const resources =
    serverless.service.provider.compiledCloudFormationTemplate.Resources;
  const stage = restApi.Stage || serverless.service.provider.stage;
  const service = serverless.service.getServiceName();
  const functionNames = [];
  const lambdaPermissions = {};

  for (const path in restApi.Body.paths) {
    const methods = filterMethods(restApi.Body.paths[path]);

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
      ] = createLambdaInvokePermission(functionName, key, path);
    });
  });

  // Create api
  createApiResources(resources, key, restApi, stage, service, functionNames);
}
function createLambdaInvokePermission(
  functionName: any,
  key: string,
  path: any
): any {
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

function createApiResources(
  resources: any[],
  key: string,
  restApi: any,
  stage: any,
  service: string,
  functionNames: any[]
) {
  resources[key] = createApi(restApi);
  resources[`${key}Deployment`] = createDeployment(key, stage);
  resources[`${key}ServiceRole`] = createServiceRole(
    stage,
    service,
    key,
    functionNames
  );
}

function createServiceRole(
  stage: any,
  service: string,
  key: string,
  functionNames: any[]
): any {
  return {
    Type: "AWS::IAM::Role",
    Properties: {
      RoleName: `${stage}-${service}-${key}-APIRole`,
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
        createLambdaExecutionPolicy(stage, service, key, functionNames)
      ]
    }
  };
}

function createLambdaExecutionPolicy(
  stage: any,
  service: string,
  key: string,
  functionNames: any[]
) {
  return {
    PolicyName: `${stage}-${service}-${key}-APIPolicy`,
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

function createDeployment(key: string, stage: any): any {
  return {
    Type: "AWS::ApiGateway::Deployment",
    DependsOn: [key],
    Properties: {
      RestApiId: { Ref: key },
      StageName: stage
    }
  };
}

function createApi(restApi: any): any {
  return {
    Type: "AWS::ApiGateway::RestApi",
    Properties: {
      Name: restApi.Name,
      Body: restApi.Body
    }
  };
}
