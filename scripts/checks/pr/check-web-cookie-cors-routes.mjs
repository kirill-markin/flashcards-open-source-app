import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// A browser sends a cookie-carrying cross-origin call only after a preflight that allows credentials,
// and API Gateway answers that preflight itself. This check fails when a web call that sends cookies
// resolves to a gateway resource whose CORS options lack `allowCredentials: true`.

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const GATEWAY_FILE = join(REPO_ROOT, "infra", "aws", "lib", "gateways", "api-gateway.ts");
const TRANSPORT_FILE = join(REPO_ROOT, "apps", "web", "src", "api", "transport", "transport.ts");
const ENDPOINTS_DIR = join(REPO_ROOT, "apps", "web", "src", "api", "endpoints");

// Every exported request helper of transport.ts, classified by whether it sends browser credentials.
const COOKIE_HELPERS = new Set(["requestJson", "requestBlob", "requestBrowserCookieJson"]);
const COOKIE_FREE_HELPERS = new Set(["requestPublicJson", "requestCredentialFreeJson"]);

const DYNAMIC_SEGMENT_MARKER = "\u0000";
const COMMENT_PATTERN = /^[ \t]*\/\*[\s\S]*?\*\/|^[ \t]*\/\/[^\n]*|[ \t]+\/\/[^\n]*/gm;
const FUNCTION_CHUNK_BOUNDARY = /^(?=(?:export\s+)?(?:async\s+)?function\s)/m;
const RESOURCE_CHAIN_PATTERN = /(?:^|[;{}])\s*(?:const\s+([A-Za-z_$][\w$]*)\s*=\s*)?(restApi\.root|[A-Za-z_$][\w$]*)((?:\s*\.(?:addResource|addMethod)\((?:[^()]|\([^()]*\))*\))+)/g;
const ADD_RESOURCE_CALL_PATTERN = /\.addResource\(\s*"([^"]+)"\s*(?:,\s*\{([^{}]*)\})?\s*\)/g;
const CORS_OPTIONS_NAME_PATTERN = /defaultCorsPreflightOptions:\s*([A-Za-z_$][\w$]*)/;
const EXPORTED_REQUEST_HELPER_PATTERN = /^export\s+(?:async\s+)?function\s+(request\w*)\s*\(/gm;
const COOKIE_CALL_PATTERN = new RegExp(`\\b(${[...COOKIE_HELPERS].join("|")})\\s*\\(\\s*`, "g");
const IDENTIFIER_PATTERN = /[A-Za-z_$][\w$]*/y;

/** Blanks comments without moving any character, so indices and line numbers stay exact. */
function blankComments(source) {
  return source.replace(COMMENT_PATTERN, (comment) => comment.replace(/[^\n]/g, " "));
}

function lineNumberAt(source, index) {
  return source.slice(0, index).split("\n").length;
}

function readCorsOptionsAllowCredentials(gatewaySource, optionsName) {
  const functionStart = gatewaySource.indexOf(`function ${optionsName}(`);
  const definitionStart = functionStart !== -1
    ? functionStart
    : gatewaySource.search(new RegExp(`\\bconst ${optionsName}\\b`));
  if (definitionStart === -1) {
    throw new Error(`${relative(REPO_ROOT, GATEWAY_FILE)} uses CORS options "${optionsName}" but does not define them as a function or const in the same file.`);
  }

  const definitionEnd = gatewaySource.indexOf("\n}", definitionStart);
  return /\ballowCredentials:\s*true\b/.test(gatewaySource.slice(definitionStart, definitionEnd));
}

function readRootCorsOptionsName(gatewaySource) {
  const restApiStart = gatewaySource.indexOf("const restApi = new apigw.RestApi(");
  const restApiEnd = gatewaySource.indexOf("\n  });", restApiStart);
  const rootOptions = restApiStart === -1 || restApiEnd === -1
    ? null
    : /\n {4}defaultCorsPreflightOptions:\s*([A-Za-z_$][\w$]*)/.exec(gatewaySource.slice(restApiStart, restApiEnd));
  if (rootOptions === null) {
    throw new Error(`${relative(REPO_ROOT, GATEWAY_FILE)} no longer declares "const restApi = new apigw.RestApi(" with a top-level defaultCorsPreflightOptions; update this check to read the root CORS options.`);
  }

  return rootOptions[1];
}

function addChildResource(parent, segment, corsOptionsName) {
  const existing = parent.children.get(segment);
  if (existing !== undefined) {
    return existing;
  }

  const child = {
    path: `${parent.path === "/" ? "" : parent.path}/${segment}`,
    corsOptionsName,
    children: new Map(),
  };
  parent.children.set(segment, child);
  return child;
}

/**
 * Rebuilds the gateway resource tree from `<parent>.addResource("<segment>", { defaultCorsPreflightOptions })`
 * chains. Every resource variable is resolved within its own function, where `restApi.root` is the root.
 */
function readGatewayResourceTree(gatewaySource) {
  const root = { path: "/", corsOptionsName: readRootCorsOptionsName(gatewaySource), children: new Map() };

  for (const chunk of gatewaySource.split(FUNCTION_CHUNK_BOUNDARY)) {
    const resourceVariables = new Map([["restApi.root", root]]);
    let parsedAddResourceCount = 0;

    for (const chain of chunk.matchAll(RESOURCE_CHAIN_PATTERN)) {
      const [, declaredName, baseName, calls] = chain;
      const addResourceCalls = [...calls.matchAll(ADD_RESOURCE_CALL_PATTERN)];
      if (addResourceCalls.length === 0) {
        continue;
      }

      let resource = resourceVariables.get(baseName);
      if (resource === undefined) {
        throw new Error(`${relative(REPO_ROOT, GATEWAY_FILE)} adds a resource under "${baseName}", which this check cannot resolve; declare it as "const ${baseName} = <parent>.addResource(...)" in the same function.`);
      }

      for (const [, segment, options] of addResourceCalls) {
        const corsOptionsName = options === undefined ? null : CORS_OPTIONS_NAME_PATTERN.exec(options)?.[1] ?? null;
        resource = addChildResource(resource, segment, corsOptionsName);
      }

      parsedAddResourceCount += addResourceCalls.length;
      if (declaredName !== undefined) {
        resourceVariables.set(declaredName, resource);
      }
    }

    const addResourceCount = chunk.match(/\.addResource\(/g)?.length ?? 0;
    if (addResourceCount !== parsedAddResourceCount) {
      throw new Error(`${relative(REPO_ROOT, GATEWAY_FILE)} has ${addResourceCount} addResource calls in one function but this check parsed ${parsedAddResourceCount}; write each as "[const name =] <resource>.addResource(\\"segment\\"[, { defaultCorsPreflightOptions: ... }])" or update this check.`);
    }
  }

  return root;
}

function findChild(resource, predicate) {
  return [...resource.children.entries()].find(([segment]) => predicate(segment))?.[1];
}

/** Mirrors API Gateway matching: a static segment, then a path parameter, then the nearest greedy proxy. */
function resolveGatewayRoute(resource, segments, index, inheritedCorsOptionsName) {
  const corsOptionsName = resource.corsOptionsName ?? inheritedCorsOptionsName;
  if (index === segments.length) {
    return { resourcePath: resource.path, corsOptionsName };
  }

  const segment = segments[index];
  const candidates = [
    segment.includes(DYNAMIC_SEGMENT_MARKER) ? undefined : resource.children.get(segment),
    findChild(resource, (childSegment) => /^\{[^+}]+\}$/.test(childSegment)),
  ];
  for (const candidate of candidates) {
    const route = candidate === undefined
      ? null
      : resolveGatewayRoute(candidate, segments, index + 1, corsOptionsName);
    if (route !== null) {
      return route;
    }
  }

  const proxy = findChild(resource, (childSegment) => /^\{[^}]+\+\}$/.test(childSegment));
  return proxy === undefined
    ? null
    : { resourcePath: proxy.path, corsOptionsName: proxy.corsOptionsName ?? corsOptionsName };
}

/** Reads a string or template literal at `index`; each `${...}` becomes one dynamic marker. */
function readPathLiteral(source, index) {
  const quote = source[index];
  if (quote !== "\"" && quote !== "'" && quote !== "`") {
    return null;
  }

  let text = "";
  let cursor = index + 1;
  while (cursor < source.length && source[cursor] !== quote) {
    if (quote === "`" && source.startsWith("${", cursor)) {
      let depth = 1;
      cursor += 2;
      while (depth > 0 && cursor < source.length) {
        depth += source[cursor] === "{" ? 1 : source[cursor] === "}" ? -1 : 0;
        cursor += 1;
      }
      text += DYNAMIC_SEGMENT_MARKER;
      continue;
    }

    text += source[cursor];
    cursor += 1;
  }

  return text;
}

/** Resolves a path argument written as a literal, a const holding one, or a same-file function returning one. */
function resolvePathArgument(source, argumentIndex) {
  const literal = readPathLiteral(source, argumentIndex);
  if (literal !== null) {
    return literal;
  }

  IDENTIFIER_PATTERN.lastIndex = argumentIndex;
  const identifier = IDENTIFIER_PATTERN.exec(source)?.[0];
  if (identifier === undefined) {
    return null;
  }

  const afterIdentifier = source.slice(argumentIndex + identifier.length).trimStart();
  if (afterIdentifier.startsWith("(")) {
    const functionStart = source.indexOf(`function ${identifier}(`);
    if (functionStart === -1) {
      return null;
    }
    const returnPattern = /\breturn\s+/g;
    returnPattern.lastIndex = functionStart;
    return returnPattern.exec(source) === null ? null : readPathLiteral(source, returnPattern.lastIndex);
  }

  const declaration = `const ${identifier} = `;
  const declarationStart = source.lastIndexOf(declaration, argumentIndex);
  return declarationStart === -1 ? null : readPathLiteral(source, declarationStart + declaration.length);
}

function readUnclassifiedRequestHelpers() {
  const transportSource = readFileSync(TRANSPORT_FILE, "utf8");
  return [...transportSource.matchAll(EXPORTED_REQUEST_HELPER_PATTERN)]
    .map(([, helperName]) => helperName)
    .filter((helperName) => !COOKIE_HELPERS.has(helperName) && !COOKIE_FREE_HELPERS.has(helperName));
}

const gatewaySource = blankComments(readFileSync(GATEWAY_FILE, "utf8"));
const gatewayRoot = readGatewayResourceTree(gatewaySource);
const violations = readUnclassifiedRequestHelpers().map((helperName) => (
  `${relative(REPO_ROOT, TRANSPORT_FILE)}: exported helper ${helperName} is not classified; add it to COOKIE_HELPERS or COOKIE_FREE_HELPERS in scripts/checks/pr/check-web-cookie-cors-routes.mjs`
));
let cookieCallCount = 0;

const endpointFiles = readdirSync(ENDPOINTS_DIR)
  .filter((fileName) => fileName.endsWith(".ts") && !fileName.endsWith(".test.ts"))
  .sort();
for (const fileName of endpointFiles) {
  const filePath = join(ENDPOINTS_DIR, fileName);
  const source = blankComments(readFileSync(filePath, "utf8"));

  for (const call of source.matchAll(COOKIE_CALL_PATTERN)) {
    const [, helperName] = call;
    const location = `${relative(REPO_ROOT, filePath)}:${lineNumberAt(source, call.index)}`;
    const pathText = resolvePathArgument(source, call.index + call[0].length);
    if (pathText === null || !pathText.startsWith("/")) {
      violations.push(`${location}: cannot resolve the path passed to ${helperName}; pass a "/..." literal, a const holding one, or a same-file function returning one.`);
      continue;
    }

    cookieCallCount += 1;
    const segments = pathText.split("?")[0].split("/").filter((segment) => segment !== "");
    const route = resolveGatewayRoute(gatewayRoot, segments, 0, gatewayRoot.corsOptionsName);
    if (route === null) {
      violations.push(`${location}: ${helperName}("${pathText.replaceAll(DYNAMIC_SEGMENT_MARKER, "{…}")}") matches no API Gateway resource in ${relative(REPO_ROOT, GATEWAY_FILE)}.`);
      continue;
    }

    if (!readCorsOptionsAllowCredentials(gatewaySource, route.corsOptionsName)) {
      violations.push(
        `${location}: ${helperName}("${pathText.replaceAll(DYNAMIC_SEGMENT_MARKER, "{…}")}") sends cookies, but API Gateway answers its preflight on ${route.resourcePath} with ${route.corsOptionsName}, which does not allow credentials, so browsers never send the request. `
        + `Give the path its own resource with createBrowserCorsPreflightOptions in ${relative(REPO_ROOT, GATEWAY_FILE)}, or call it with a cookie-free helper.`,
      );
    }
  }
}

if (violations.length > 0) {
  console.error("Web cookie CORS route check failed:\n" + violations.join("\n"));
  process.exit(1);
}
console.log("Web cookie CORS route check passed.", { endpointFiles: endpointFiles.length, cookieCalls: cookieCallCount });
