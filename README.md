<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Project setup

Use `npm ci` to reproduce the reviewed lockfile. The dependency maintenance work
keeps Nest/CLI 11, Jest 30, ts-jest 29 and ESLint 9; Node.js 24 is the runtime used
for local validation. Do not use `npm audit fix --force` to replace these tools
with unrelated major versions or downgrade the test runner.

### Dependency regression checks

Run `npx tsc --noEmit`, `npx eslint "{src,apps,libs,test}/**/*.ts"`,
`npm test -- --runInBand`, `npm run test:e2e -- --runInBand` and `npm run build`.
The backend lint npm script uses `--fix`; the direct command above only checks.

The e2e suite uses the real application, Multer, file signatures, sessions and
request limits, with Axios providers simulated. It does not call Sightengine or
Cloudflare. It covers `/health`, PNG analysis, session renewal/expiration,
challenge acceptance/rejection, invalid/oversized uploads and provider failures.
The existing rate-limit error/header contract remains a separate task (P1-02).

`test/jest-e2e.json` enables the `module-sync` export condition and transforms
only file-type's ESM dependency chain through ts-jest. This allows real file
signature tests without changing the application's TypeScript/module settings
or mocking file-type. Run e2e with permission to create loopback sockets.

Audit both `npm audit --package-lock-only` and
`npm audit --package-lock-only --omit=dev`. Remaining development-only advisories
in glob/minimatch/deepmerge need separate migration decisions; the full audit is
not expected to return zero yet. ESLint 9 is EOL; moving to a supported major is
also deferred. These are tracked in the workspace audit, not silently waived.

```bash
$ npm install
```

## Security env (anti-bot)

Configura estas variables para validar Turnstile en `POST /detect/ai`:

```bash
TURNSTILE_SECRET_KEY=
TURNSTILE_VERIFY_URL=https://challenges.cloudflare.com/turnstile/v0/siteverify
TURNSTILE_TIMEOUT_MS=7000
BOT_TOKEN_FIELD=turnstileToken
BOT_SESSION_HEADER=x-bot-session-token
TURNSTILE_SESSION_SECRET=
TURNSTILE_SESSION_TTL_MS=900000
CORS_ALLOWED_ORIGINS=https://alejodraws.com,https://www.alejodraws.com,https://alejo-tools-web.vercel.app,http://localhost:3000
```

El frontend debe enviar el token en el campo multipart `turnstileToken` (o el valor definido en `BOT_TOKEN_FIELD`). También se acepta por header `x-turnstile-token` o `cf-turnstile-response`.

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ npm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
