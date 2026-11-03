/**
 * Conventional commits, with the scope restricted to modules that exist in this monorepo.
 * Same rule as LetsDelivery/JiraIA: the scope is a module, not a feature.
 */
const SERVICES = ['api']
const PACKAGES = ['core', 'postman', 'send', 'docs']
const APPS = ['web']
const INFRA = ['deploy', 'docs', 'repo']
const CHORE = ['deps']

module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-empty': [2, 'never'],
    'scope-enum': [2, 'always', [...SERVICES, ...PACKAGES, ...APPS, ...INFRA, ...CHORE]],
    'subject-case': [2, 'never', ['start-case', 'pascal-case', 'upper-case']],
    'header-max-length': [2, 'always', 100],
    'body-max-line-length': [2, 'always', 100]
  }
}
