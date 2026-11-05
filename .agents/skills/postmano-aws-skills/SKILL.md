---
name: postmano-aws-skills
description: "In the postmano repository: AWS infrastructure and architecture patterns — load it before changing template.yml, IAM, Cognito, Secrets Manager, DynamoDB, CloudFront, the Lambda or any AWS resource. It carries what this repository decided about its one plain-CloudFormation stack."
risk: safe
source: "https://github.com/zxkane/aws-skills"
---

# Aws Skills

## Overview

AWS development with infrastructure automation and cloud architecture patterns

## When to Use This Skill

Use this skill when you need to work with aws development with infrastructure automation and cloud architecture patterns.

## Instructions

This skill provides guidance and patterns for aws development with infrastructure automation and cloud architecture patterns.

For more information, see the [source repository](https://github.com/zxkane/aws-skills).

## What this repository decided wins

Where general AWS guidance and this repository disagree, `template.yml`, `docs/deploy.md` and `docs/adr/` win:

- **One stack, plain CloudFormation**: a single `template.yml` at the root, no SAM, no CDK. One API Lambda
  (`services/api/src/lambda.ts`) behind an HTTP API route `ANY /{proxy+}`, plus a small one that publishes the panel,
  and a CloudFront distribution in front of both the panel (S3, origin access control) and `/api/*`.
- **DynamoDB, one table, documents in gzipped chunks** (see the store in `services/api/src/store/`), not Aurora.
- **One deployment only.** The tool is internal, so there is no dev/prod pair. It lives in the dev AWS account. A value
  that differs per account goes in `Mappings` (`EnvConfig`), and a new account needs its own block, even with empty
  values (`!FindInMap` resolves at deploy time against the deploying account only).
- **A secret goes in Secrets Manager** (`postmano/google`), a plain value in SSM (`/postmano/google/client-id`).
- **Sign-in is Google through Cognito**, restricted to the company's domains, with `hd` required.
- **The panel is published by a custom resource** that copies the build from the pipeline bucket to the site bucket and
  invalidates the CDN. Keep its inline code under the 4096-character limit of `ZipFile`.
- **No VPC.** The Lambda reaches the internet directly, and the proxy refuses private destinations in code.
- **Every change to `template.yml` needs the whole changeset run in CloudFormation before the pull request**, and the
  pull request says so. `cfn-lint` passes templates that fail at deploy.

For Lambda, API Gateway and CloudFront questions — cold starts, 502/504s, throttling, cache behaviour — load the
personal `aws-serverless` skill if your installation has it; its SAM advice does not apply here.
