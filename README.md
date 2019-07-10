Serverless Swagger API
======================

[![Build Status](https://travis-ci.org/theBenForce/serverless-swagger-api.svg?branch=master)](https://travis-ci.org/theBenForce/serverless-swagger-api) [![Maintainability](https://api.codeclimate.com/v1/badges/b9a5ee60a1ec6eba104d/maintainability)](https://codeclimate.com/github/theBenForce/serverless-swagger-api/maintainability) [![npm version](https://badge.fury.io/js/serverless-swagger-api.svg)](https://badge.fury.io/js/serverless-swagger-api)

This is a serverless plugin that simplifies the process of creating an AWS API Gateway from a swagger file.

## Installation

```bash
yarn add --dev serverless-swagger-api
```

## Configuration

### Lambda Functions
You must manually create your own lambda functions in the serverless configuration. Once the methods are created, they will be referenced in the swagger file.

### Swagger File
Add a `x-lambda-name` property to every path method to bind a part of the api to a lambda.

```yaml
paths:
  /testPath:
    get:
      x-lambda-name: TestPathLambdaFunction
      ...
```

### Plugin Settings
Now you need to tell the swagger api plugin about your configuration file. Add a `swaggerApi` property to the custom section of your serverless configuration. You can add as many apis as you want by adding children to the `swaggerApi` property.

```yaml
custom:
  swaggerApi:
    PrimaryApi:
      Name: ${self:provider.stage}-${self:service}-PrimaryApi
      Body: ${file(./some-swagger-file.yaml)}
      Stage: dev
```