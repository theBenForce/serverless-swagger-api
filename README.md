# Serverless Swagger API

[![Build Status](https://travis-ci.org/drg-adaptive/serverless-swagger-api.svg)](https://travis-ci.org/drg-adaptive/serverless-swagger-api)
[![Maintainability](https://api.codeclimate.com/v1/badges/006339522a8624e9bacb/maintainability)](https://codeclimate.com/github/drg-adaptive/serverless-swagger-api/maintainability)
[![npm version](https://badge.fury.io/js/serverless-swagger-api.svg)](https://badge.fury.io/js/serverless-swagger-api)
[![FOSSA Status](https://app.fossa.io/api/projects/git%2Bgithub.com%2Fdrg-adaptive%2Fserverless-swagger-api.svg?type=shield)](https://app.fossa.io/projects/git%2Bgithub.com%2Fdrg-adaptive%2Fserverless-swagger-api?ref=badge_shield)

This is a serverless plugin that simplifies the process of creating an AWS API Gateway from a swagger file.

## Installation

```bash
yarn add --dev serverless-swagger-api
```

## Configuration

### Lambda Functions

You must manually create your own lambda functions in the serverless configuration. Once the methods are created, they will be referenced in the swagger file.

### Swagger File

Add a `x-lambda-name` property to every path method to bind a part of the api to a lambda. Values specified for `x-lambda-name` is AWS CloudFormation resource names, i.e., [values in the form of `{normalizedFunctionName}LambdaFunction`](https://www.serverless.com/framework/docs/providers/aws/guide/resources#aws-cloudformation-resource-reference). For more information about naming rules, please refer to the [description](https://www.serverless.com/framework/docs/providers/aws/guide/resources#override-aws-cloudformation-resource) in the Serverless Framework documentation.

```yaml
paths:
  /testPath:
    get:
      x-lambda-name: TestPathLambdaFunction
      ...
```

#### CORS Configuration

Add a `x-cors` property to the path you want to add CORS options responses to.

```yaml
paths:
  /testPath:
    x-cors: true
```

If you want to specify a specific attribute, provide one of the following properties

| Property | Description                         | Default                                                       |
| -------- | ----------------------------------- | ------------------------------------------------------------- |
| origin   | A string specifying allowed origins | \*                                                            |
| headers  | An array of headers to be allowed   | Constructed from the parameters property of every path method |
| methods  | An array of methods to be allowed   | Constructed by looking at all methods defined for a path      |

### Plugin Settings

Now you need to tell the swagger api plugin about your configuration file. Add a `swaggerApi` property to the custom section of your serverless configuration. You can add as many apis as you want by adding children to the `swaggerApi.apis` property.

#### updateDeployments

Will automatically update API gateway deployments if not set to `false`.

#### usePackageVersion

The `info.version` value in your OpenAPI file will be overwritten with the version in `package.json`.

#### apis

An object containing all of the APIs to be defined in this stack.

```yaml
custom:
  swaggerApi:
    updateDeployments: true
    usePackageVersion: true
    apis:
      PrimaryApi:
        Name: ${self:provider.stage}-${self:service}-PrimaryApi
        Body: ${file(./some-swagger-file.yaml)}
        Lambda: ExampleLambdaFunction
        Stage: dev
```

##### Properties

Each API object has the following properties

| Name   | Required | Description                                                                                                                                                          |
| ------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Name   | Yes      | Name of the API that will be used as the `Name` parameter when creating the `AWS::ApiGateway::RestApi` CloudFormation object                                         |
| Body   | Yes      | The swagger/openapi file that defines the API                                                                                                                        |
| Stage  | Yes      | The name of the API Gateway stage that will be created                                                                                                               |
| Lambda | No       | Default lambda name that will be used if `x-lambda-name` isn't provided on a path (see the description of `x-lambda-name` for the value to be specified as the name) |

## Created Resources

### IAM Roles
An IAM role is created for each API with the name `PrimaryApiServiceRole`

## License

[![FOSSA Status](https://app.fossa.io/api/projects/git%2Bgithub.com%2Fdrg-adaptive%2Fserverless-swagger-api.svg?type=large)](https://app.fossa.io/projects/git%2Bgithub.com%2Fdrg-adaptive%2Fserverless-swagger-api?ref=badge_large)
