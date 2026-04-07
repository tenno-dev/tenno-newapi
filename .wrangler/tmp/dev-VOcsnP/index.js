var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// node_modules/.pnpm/hono@4.12.12/node_modules/hono/dist/compose.js
var compose = /* @__PURE__ */ __name((middleware, onError, onNotFound) => {
  return (context, next) => {
    let index = -1;
    return dispatch(0);
    async function dispatch(i) {
      if (i <= index) {
        throw new Error("next() called multiple times");
      }
      index = i;
      let res;
      let isError = false;
      let handler;
      if (middleware[i]) {
        handler = middleware[i][0][0];
        context.req.routeIndex = i;
      } else {
        handler = i === middleware.length && next || void 0;
      }
      if (handler) {
        try {
          res = await handler(context, () => dispatch(i + 1));
        } catch (err) {
          if (err instanceof Error && onError) {
            context.error = err;
            res = await onError(err, context);
            isError = true;
          } else {
            throw err;
          }
        }
      } else {
        if (context.finalized === false && onNotFound) {
          res = await onNotFound(context);
        }
      }
      if (res && (context.finalized === false || isError)) {
        context.res = res;
      }
      return context;
    }
    __name(dispatch, "dispatch");
  };
}, "compose");

// node_modules/.pnpm/hono@4.12.12/node_modules/hono/dist/request/constants.js
var GET_MATCH_RESULT = /* @__PURE__ */ Symbol();

// node_modules/.pnpm/hono@4.12.12/node_modules/hono/dist/utils/body.js
var parseBody = /* @__PURE__ */ __name(async (request, options = /* @__PURE__ */ Object.create(null)) => {
  const { all = false, dot = false } = options;
  const headers = request instanceof HonoRequest ? request.raw.headers : request.headers;
  const contentType = headers.get("Content-Type");
  if (contentType?.startsWith("multipart/form-data") || contentType?.startsWith("application/x-www-form-urlencoded")) {
    return parseFormData(request, { all, dot });
  }
  return {};
}, "parseBody");
async function parseFormData(request, options) {
  const formData = await request.formData();
  if (formData) {
    return convertFormDataToBodyData(formData, options);
  }
  return {};
}
__name(parseFormData, "parseFormData");
function convertFormDataToBodyData(formData, options) {
  const form = /* @__PURE__ */ Object.create(null);
  formData.forEach((value, key) => {
    const shouldParseAllValues = options.all || key.endsWith("[]");
    if (!shouldParseAllValues) {
      form[key] = value;
    } else {
      handleParsingAllValues(form, key, value);
    }
  });
  if (options.dot) {
    Object.entries(form).forEach(([key, value]) => {
      const shouldParseDotValues = key.includes(".");
      if (shouldParseDotValues) {
        handleParsingNestedValues(form, key, value);
        delete form[key];
      }
    });
  }
  return form;
}
__name(convertFormDataToBodyData, "convertFormDataToBodyData");
var handleParsingAllValues = /* @__PURE__ */ __name((form, key, value) => {
  if (form[key] !== void 0) {
    if (Array.isArray(form[key])) {
      ;
      form[key].push(value);
    } else {
      form[key] = [form[key], value];
    }
  } else {
    if (!key.endsWith("[]")) {
      form[key] = value;
    } else {
      form[key] = [value];
    }
  }
}, "handleParsingAllValues");
var handleParsingNestedValues = /* @__PURE__ */ __name((form, key, value) => {
  if (/(?:^|\.)__proto__\./.test(key)) {
    return;
  }
  let nestedForm = form;
  const keys = key.split(".");
  keys.forEach((key2, index) => {
    if (index === keys.length - 1) {
      nestedForm[key2] = value;
    } else {
      if (!nestedForm[key2] || typeof nestedForm[key2] !== "object" || Array.isArray(nestedForm[key2]) || nestedForm[key2] instanceof File) {
        nestedForm[key2] = /* @__PURE__ */ Object.create(null);
      }
      nestedForm = nestedForm[key2];
    }
  });
}, "handleParsingNestedValues");

// node_modules/.pnpm/hono@4.12.12/node_modules/hono/dist/utils/url.js
var splitPath = /* @__PURE__ */ __name((path) => {
  const paths = path.split("/");
  if (paths[0] === "") {
    paths.shift();
  }
  return paths;
}, "splitPath");
var splitRoutingPath = /* @__PURE__ */ __name((routePath) => {
  const { groups, path } = extractGroupsFromPath(routePath);
  const paths = splitPath(path);
  return replaceGroupMarks(paths, groups);
}, "splitRoutingPath");
var extractGroupsFromPath = /* @__PURE__ */ __name((path) => {
  const groups = [];
  path = path.replace(/\{[^}]+\}/g, (match2, index) => {
    const mark = `@${index}`;
    groups.push([mark, match2]);
    return mark;
  });
  return { groups, path };
}, "extractGroupsFromPath");
var replaceGroupMarks = /* @__PURE__ */ __name((paths, groups) => {
  for (let i = groups.length - 1; i >= 0; i--) {
    const [mark] = groups[i];
    for (let j = paths.length - 1; j >= 0; j--) {
      if (paths[j].includes(mark)) {
        paths[j] = paths[j].replace(mark, groups[i][1]);
        break;
      }
    }
  }
  return paths;
}, "replaceGroupMarks");
var patternCache = {};
var getPattern = /* @__PURE__ */ __name((label, next) => {
  if (label === "*") {
    return "*";
  }
  const match2 = label.match(/^\:([^\{\}]+)(?:\{(.+)\})?$/);
  if (match2) {
    const cacheKey = `${label}#${next}`;
    if (!patternCache[cacheKey]) {
      if (match2[2]) {
        patternCache[cacheKey] = next && next[0] !== ":" && next[0] !== "*" ? [cacheKey, match2[1], new RegExp(`^${match2[2]}(?=/${next})`)] : [label, match2[1], new RegExp(`^${match2[2]}$`)];
      } else {
        patternCache[cacheKey] = [label, match2[1], true];
      }
    }
    return patternCache[cacheKey];
  }
  return null;
}, "getPattern");
var tryDecode = /* @__PURE__ */ __name((str, decoder) => {
  try {
    return decoder(str);
  } catch {
    return str.replace(/(?:%[0-9A-Fa-f]{2})+/g, (match2) => {
      try {
        return decoder(match2);
      } catch {
        return match2;
      }
    });
  }
}, "tryDecode");
var tryDecodeURI = /* @__PURE__ */ __name((str) => tryDecode(str, decodeURI), "tryDecodeURI");
var getPath = /* @__PURE__ */ __name((request) => {
  const url = request.url;
  const start = url.indexOf("/", url.indexOf(":") + 4);
  let i = start;
  for (; i < url.length; i++) {
    const charCode = url.charCodeAt(i);
    if (charCode === 37) {
      const queryIndex = url.indexOf("?", i);
      const hashIndex = url.indexOf("#", i);
      const end = queryIndex === -1 ? hashIndex === -1 ? void 0 : hashIndex : hashIndex === -1 ? queryIndex : Math.min(queryIndex, hashIndex);
      const path = url.slice(start, end);
      return tryDecodeURI(path.includes("%25") ? path.replace(/%25/g, "%2525") : path);
    } else if (charCode === 63 || charCode === 35) {
      break;
    }
  }
  return url.slice(start, i);
}, "getPath");
var getPathNoStrict = /* @__PURE__ */ __name((request) => {
  const result = getPath(request);
  return result.length > 1 && result.at(-1) === "/" ? result.slice(0, -1) : result;
}, "getPathNoStrict");
var mergePath = /* @__PURE__ */ __name((base, sub, ...rest) => {
  if (rest.length) {
    sub = mergePath(sub, ...rest);
  }
  return `${base?.[0] === "/" ? "" : "/"}${base}${sub === "/" ? "" : `${base?.at(-1) === "/" ? "" : "/"}${sub?.[0] === "/" ? sub.slice(1) : sub}`}`;
}, "mergePath");
var checkOptionalParameter = /* @__PURE__ */ __name((path) => {
  if (path.charCodeAt(path.length - 1) !== 63 || !path.includes(":")) {
    return null;
  }
  const segments = path.split("/");
  const results = [];
  let basePath = "";
  segments.forEach((segment) => {
    if (segment !== "" && !/\:/.test(segment)) {
      basePath += "/" + segment;
    } else if (/\:/.test(segment)) {
      if (/\?/.test(segment)) {
        if (results.length === 0 && basePath === "") {
          results.push("/");
        } else {
          results.push(basePath);
        }
        const optionalSegment = segment.replace("?", "");
        basePath += "/" + optionalSegment;
        results.push(basePath);
      } else {
        basePath += "/" + segment;
      }
    }
  });
  return results.filter((v, i, a) => a.indexOf(v) === i);
}, "checkOptionalParameter");
var _decodeURI = /* @__PURE__ */ __name((value) => {
  if (!/[%+]/.test(value)) {
    return value;
  }
  if (value.indexOf("+") !== -1) {
    value = value.replace(/\+/g, " ");
  }
  return value.indexOf("%") !== -1 ? tryDecode(value, decodeURIComponent_) : value;
}, "_decodeURI");
var _getQueryParam = /* @__PURE__ */ __name((url, key, multiple) => {
  let encoded;
  if (!multiple && key && !/[%+]/.test(key)) {
    let keyIndex2 = url.indexOf("?", 8);
    if (keyIndex2 === -1) {
      return void 0;
    }
    if (!url.startsWith(key, keyIndex2 + 1)) {
      keyIndex2 = url.indexOf(`&${key}`, keyIndex2 + 1);
    }
    while (keyIndex2 !== -1) {
      const trailingKeyCode = url.charCodeAt(keyIndex2 + key.length + 1);
      if (trailingKeyCode === 61) {
        const valueIndex = keyIndex2 + key.length + 2;
        const endIndex = url.indexOf("&", valueIndex);
        return _decodeURI(url.slice(valueIndex, endIndex === -1 ? void 0 : endIndex));
      } else if (trailingKeyCode == 38 || isNaN(trailingKeyCode)) {
        return "";
      }
      keyIndex2 = url.indexOf(`&${key}`, keyIndex2 + 1);
    }
    encoded = /[%+]/.test(url);
    if (!encoded) {
      return void 0;
    }
  }
  const results = {};
  encoded ??= /[%+]/.test(url);
  let keyIndex = url.indexOf("?", 8);
  while (keyIndex !== -1) {
    const nextKeyIndex = url.indexOf("&", keyIndex + 1);
    let valueIndex = url.indexOf("=", keyIndex);
    if (valueIndex > nextKeyIndex && nextKeyIndex !== -1) {
      valueIndex = -1;
    }
    let name = url.slice(
      keyIndex + 1,
      valueIndex === -1 ? nextKeyIndex === -1 ? void 0 : nextKeyIndex : valueIndex
    );
    if (encoded) {
      name = _decodeURI(name);
    }
    keyIndex = nextKeyIndex;
    if (name === "") {
      continue;
    }
    let value;
    if (valueIndex === -1) {
      value = "";
    } else {
      value = url.slice(valueIndex + 1, nextKeyIndex === -1 ? void 0 : nextKeyIndex);
      if (encoded) {
        value = _decodeURI(value);
      }
    }
    if (multiple) {
      if (!(results[name] && Array.isArray(results[name]))) {
        results[name] = [];
      }
      ;
      results[name].push(value);
    } else {
      results[name] ??= value;
    }
  }
  return key ? results[key] : results;
}, "_getQueryParam");
var getQueryParam = _getQueryParam;
var getQueryParams = /* @__PURE__ */ __name((url, key) => {
  return _getQueryParam(url, key, true);
}, "getQueryParams");
var decodeURIComponent_ = decodeURIComponent;

// node_modules/.pnpm/hono@4.12.12/node_modules/hono/dist/request.js
var tryDecodeURIComponent = /* @__PURE__ */ __name((str) => tryDecode(str, decodeURIComponent_), "tryDecodeURIComponent");
var HonoRequest = class {
  static {
    __name(this, "HonoRequest");
  }
  /**
   * `.raw` can get the raw Request object.
   *
   * @see {@link https://hono.dev/docs/api/request#raw}
   *
   * @example
   * ```ts
   * // For Cloudflare Workers
   * app.post('/', async (c) => {
   *   const metadata = c.req.raw.cf?.hostMetadata?
   *   ...
   * })
   * ```
   */
  raw;
  #validatedData;
  // Short name of validatedData
  #matchResult;
  routeIndex = 0;
  /**
   * `.path` can get the pathname of the request.
   *
   * @see {@link https://hono.dev/docs/api/request#path}
   *
   * @example
   * ```ts
   * app.get('/about/me', (c) => {
   *   const pathname = c.req.path // `/about/me`
   * })
   * ```
   */
  path;
  bodyCache = {};
  constructor(request, path = "/", matchResult = [[]]) {
    this.raw = request;
    this.path = path;
    this.#matchResult = matchResult;
    this.#validatedData = {};
  }
  param(key) {
    return key ? this.#getDecodedParam(key) : this.#getAllDecodedParams();
  }
  #getDecodedParam(key) {
    const paramKey = this.#matchResult[0][this.routeIndex][1][key];
    const param = this.#getParamValue(paramKey);
    return param && /\%/.test(param) ? tryDecodeURIComponent(param) : param;
  }
  #getAllDecodedParams() {
    const decoded = {};
    const keys = Object.keys(this.#matchResult[0][this.routeIndex][1]);
    for (const key of keys) {
      const value = this.#getParamValue(this.#matchResult[0][this.routeIndex][1][key]);
      if (value !== void 0) {
        decoded[key] = /\%/.test(value) ? tryDecodeURIComponent(value) : value;
      }
    }
    return decoded;
  }
  #getParamValue(paramKey) {
    return this.#matchResult[1] ? this.#matchResult[1][paramKey] : paramKey;
  }
  query(key) {
    return getQueryParam(this.url, key);
  }
  queries(key) {
    return getQueryParams(this.url, key);
  }
  header(name) {
    if (name) {
      return this.raw.headers.get(name) ?? void 0;
    }
    const headerData = {};
    this.raw.headers.forEach((value, key) => {
      headerData[key] = value;
    });
    return headerData;
  }
  async parseBody(options) {
    return parseBody(this, options);
  }
  #cachedBody = /* @__PURE__ */ __name((key) => {
    const { bodyCache, raw: raw2 } = this;
    const cachedBody = bodyCache[key];
    if (cachedBody) {
      return cachedBody;
    }
    const anyCachedKey = Object.keys(bodyCache)[0];
    if (anyCachedKey) {
      return bodyCache[anyCachedKey].then((body) => {
        if (anyCachedKey === "json") {
          body = JSON.stringify(body);
        }
        return new Response(body)[key]();
      });
    }
    return bodyCache[key] = raw2[key]();
  }, "#cachedBody");
  /**
   * `.json()` can parse Request body of type `application/json`
   *
   * @see {@link https://hono.dev/docs/api/request#json}
   *
   * @example
   * ```ts
   * app.post('/entry', async (c) => {
   *   const body = await c.req.json()
   * })
   * ```
   */
  json() {
    return this.#cachedBody("text").then((text) => JSON.parse(text));
  }
  /**
   * `.text()` can parse Request body of type `text/plain`
   *
   * @see {@link https://hono.dev/docs/api/request#text}
   *
   * @example
   * ```ts
   * app.post('/entry', async (c) => {
   *   const body = await c.req.text()
   * })
   * ```
   */
  text() {
    return this.#cachedBody("text");
  }
  /**
   * `.arrayBuffer()` parse Request body as an `ArrayBuffer`
   *
   * @see {@link https://hono.dev/docs/api/request#arraybuffer}
   *
   * @example
   * ```ts
   * app.post('/entry', async (c) => {
   *   const body = await c.req.arrayBuffer()
   * })
   * ```
   */
  arrayBuffer() {
    return this.#cachedBody("arrayBuffer");
  }
  /**
   * Parses the request body as a `Blob`.
   * @example
   * ```ts
   * app.post('/entry', async (c) => {
   *   const body = await c.req.blob();
   * });
   * ```
   * @see https://hono.dev/docs/api/request#blob
   */
  blob() {
    return this.#cachedBody("blob");
  }
  /**
   * Parses the request body as `FormData`.
   * @example
   * ```ts
   * app.post('/entry', async (c) => {
   *   const body = await c.req.formData();
   * });
   * ```
   * @see https://hono.dev/docs/api/request#formdata
   */
  formData() {
    return this.#cachedBody("formData");
  }
  /**
   * Adds validated data to the request.
   *
   * @param target - The target of the validation.
   * @param data - The validated data to add.
   */
  addValidatedData(target, data) {
    this.#validatedData[target] = data;
  }
  valid(target) {
    return this.#validatedData[target];
  }
  /**
   * `.url()` can get the request url strings.
   *
   * @see {@link https://hono.dev/docs/api/request#url}
   *
   * @example
   * ```ts
   * app.get('/about/me', (c) => {
   *   const url = c.req.url // `http://localhost:8787/about/me`
   *   ...
   * })
   * ```
   */
  get url() {
    return this.raw.url;
  }
  /**
   * `.method()` can get the method name of the request.
   *
   * @see {@link https://hono.dev/docs/api/request#method}
   *
   * @example
   * ```ts
   * app.get('/about/me', (c) => {
   *   const method = c.req.method // `GET`
   * })
   * ```
   */
  get method() {
    return this.raw.method;
  }
  get [GET_MATCH_RESULT]() {
    return this.#matchResult;
  }
  /**
   * `.matchedRoutes()` can return a matched route in the handler
   *
   * @deprecated
   *
   * Use matchedRoutes helper defined in "hono/route" instead.
   *
   * @see {@link https://hono.dev/docs/api/request#matchedroutes}
   *
   * @example
   * ```ts
   * app.use('*', async function logger(c, next) {
   *   await next()
   *   c.req.matchedRoutes.forEach(({ handler, method, path }, i) => {
   *     const name = handler.name || (handler.length < 2 ? '[handler]' : '[middleware]')
   *     console.log(
   *       method,
   *       ' ',
   *       path,
   *       ' '.repeat(Math.max(10 - path.length, 0)),
   *       name,
   *       i === c.req.routeIndex ? '<- respond from here' : ''
   *     )
   *   })
   * })
   * ```
   */
  get matchedRoutes() {
    return this.#matchResult[0].map(([[, route]]) => route);
  }
  /**
   * `routePath()` can retrieve the path registered within the handler
   *
   * @deprecated
   *
   * Use routePath helper defined in "hono/route" instead.
   *
   * @see {@link https://hono.dev/docs/api/request#routepath}
   *
   * @example
   * ```ts
   * app.get('/posts/:id', (c) => {
   *   return c.json({ path: c.req.routePath })
   * })
   * ```
   */
  get routePath() {
    return this.#matchResult[0].map(([[, route]]) => route)[this.routeIndex].path;
  }
};

// node_modules/.pnpm/hono@4.12.12/node_modules/hono/dist/utils/html.js
var HtmlEscapedCallbackPhase = {
  Stringify: 1,
  BeforeStream: 2,
  Stream: 3
};
var raw = /* @__PURE__ */ __name((value, callbacks) => {
  const escapedString = new String(value);
  escapedString.isEscaped = true;
  escapedString.callbacks = callbacks;
  return escapedString;
}, "raw");
var resolveCallback = /* @__PURE__ */ __name(async (str, phase, preserveCallbacks, context, buffer) => {
  if (typeof str === "object" && !(str instanceof String)) {
    if (!(str instanceof Promise)) {
      str = str.toString();
    }
    if (str instanceof Promise) {
      str = await str;
    }
  }
  const callbacks = str.callbacks;
  if (!callbacks?.length) {
    return Promise.resolve(str);
  }
  if (buffer) {
    buffer[0] += str;
  } else {
    buffer = [str];
  }
  const resStr = Promise.all(callbacks.map((c) => c({ phase, buffer, context }))).then(
    (res) => Promise.all(
      res.filter(Boolean).map((str2) => resolveCallback(str2, phase, false, context, buffer))
    ).then(() => buffer[0])
  );
  if (preserveCallbacks) {
    return raw(await resStr, callbacks);
  } else {
    return resStr;
  }
}, "resolveCallback");

// node_modules/.pnpm/hono@4.12.12/node_modules/hono/dist/context.js
var TEXT_PLAIN = "text/plain; charset=UTF-8";
var setDefaultContentType = /* @__PURE__ */ __name((contentType, headers) => {
  return {
    "Content-Type": contentType,
    ...headers
  };
}, "setDefaultContentType");
var createResponseInstance = /* @__PURE__ */ __name((body, init) => new Response(body, init), "createResponseInstance");
var Context = class {
  static {
    __name(this, "Context");
  }
  #rawRequest;
  #req;
  /**
   * `.env` can get bindings (environment variables, secrets, KV namespaces, D1 database, R2 bucket etc.) in Cloudflare Workers.
   *
   * @see {@link https://hono.dev/docs/api/context#env}
   *
   * @example
   * ```ts
   * // Environment object for Cloudflare Workers
   * app.get('*', async c => {
   *   const counter = c.env.COUNTER
   * })
   * ```
   */
  env = {};
  #var;
  finalized = false;
  /**
   * `.error` can get the error object from the middleware if the Handler throws an error.
   *
   * @see {@link https://hono.dev/docs/api/context#error}
   *
   * @example
   * ```ts
   * app.use('*', async (c, next) => {
   *   await next()
   *   if (c.error) {
   *     // do something...
   *   }
   * })
   * ```
   */
  error;
  #status;
  #executionCtx;
  #res;
  #layout;
  #renderer;
  #notFoundHandler;
  #preparedHeaders;
  #matchResult;
  #path;
  /**
   * Creates an instance of the Context class.
   *
   * @param req - The Request object.
   * @param options - Optional configuration options for the context.
   */
  constructor(req, options) {
    this.#rawRequest = req;
    if (options) {
      this.#executionCtx = options.executionCtx;
      this.env = options.env;
      this.#notFoundHandler = options.notFoundHandler;
      this.#path = options.path;
      this.#matchResult = options.matchResult;
    }
  }
  /**
   * `.req` is the instance of {@link HonoRequest}.
   */
  get req() {
    this.#req ??= new HonoRequest(this.#rawRequest, this.#path, this.#matchResult);
    return this.#req;
  }
  /**
   * @see {@link https://hono.dev/docs/api/context#event}
   * The FetchEvent associated with the current request.
   *
   * @throws Will throw an error if the context does not have a FetchEvent.
   */
  get event() {
    if (this.#executionCtx && "respondWith" in this.#executionCtx) {
      return this.#executionCtx;
    } else {
      throw Error("This context has no FetchEvent");
    }
  }
  /**
   * @see {@link https://hono.dev/docs/api/context#executionctx}
   * The ExecutionContext associated with the current request.
   *
   * @throws Will throw an error if the context does not have an ExecutionContext.
   */
  get executionCtx() {
    if (this.#executionCtx) {
      return this.#executionCtx;
    } else {
      throw Error("This context has no ExecutionContext");
    }
  }
  /**
   * @see {@link https://hono.dev/docs/api/context#res}
   * The Response object for the current request.
   */
  get res() {
    return this.#res ||= createResponseInstance(null, {
      headers: this.#preparedHeaders ??= new Headers()
    });
  }
  /**
   * Sets the Response object for the current request.
   *
   * @param _res - The Response object to set.
   */
  set res(_res) {
    if (this.#res && _res) {
      _res = createResponseInstance(_res.body, _res);
      for (const [k, v] of this.#res.headers.entries()) {
        if (k === "content-type") {
          continue;
        }
        if (k === "set-cookie") {
          const cookies = this.#res.headers.getSetCookie();
          _res.headers.delete("set-cookie");
          for (const cookie of cookies) {
            _res.headers.append("set-cookie", cookie);
          }
        } else {
          _res.headers.set(k, v);
        }
      }
    }
    this.#res = _res;
    this.finalized = true;
  }
  /**
   * `.render()` can create a response within a layout.
   *
   * @see {@link https://hono.dev/docs/api/context#render-setrenderer}
   *
   * @example
   * ```ts
   * app.get('/', (c) => {
   *   return c.render('Hello!')
   * })
   * ```
   */
  render = /* @__PURE__ */ __name((...args) => {
    this.#renderer ??= (content) => this.html(content);
    return this.#renderer(...args);
  }, "render");
  /**
   * Sets the layout for the response.
   *
   * @param layout - The layout to set.
   * @returns The layout function.
   */
  setLayout = /* @__PURE__ */ __name((layout) => this.#layout = layout, "setLayout");
  /**
   * Gets the current layout for the response.
   *
   * @returns The current layout function.
   */
  getLayout = /* @__PURE__ */ __name(() => this.#layout, "getLayout");
  /**
   * `.setRenderer()` can set the layout in the custom middleware.
   *
   * @see {@link https://hono.dev/docs/api/context#render-setrenderer}
   *
   * @example
   * ```tsx
   * app.use('*', async (c, next) => {
   *   c.setRenderer((content) => {
   *     return c.html(
   *       <html>
   *         <body>
   *           <p>{content}</p>
   *         </body>
   *       </html>
   *     )
   *   })
   *   await next()
   * })
   * ```
   */
  setRenderer = /* @__PURE__ */ __name((renderer) => {
    this.#renderer = renderer;
  }, "setRenderer");
  /**
   * `.header()` can set headers.
   *
   * @see {@link https://hono.dev/docs/api/context#header}
   *
   * @example
   * ```ts
   * app.get('/welcome', (c) => {
   *   // Set headers
   *   c.header('X-Message', 'Hello!')
   *   c.header('Content-Type', 'text/plain')
   *
   *   return c.body('Thank you for coming')
   * })
   * ```
   */
  header = /* @__PURE__ */ __name((name, value, options) => {
    if (this.finalized) {
      this.#res = createResponseInstance(this.#res.body, this.#res);
    }
    const headers = this.#res ? this.#res.headers : this.#preparedHeaders ??= new Headers();
    if (value === void 0) {
      headers.delete(name);
    } else if (options?.append) {
      headers.append(name, value);
    } else {
      headers.set(name, value);
    }
  }, "header");
  status = /* @__PURE__ */ __name((status) => {
    this.#status = status;
  }, "status");
  /**
   * `.set()` can set the value specified by the key.
   *
   * @see {@link https://hono.dev/docs/api/context#set-get}
   *
   * @example
   * ```ts
   * app.use('*', async (c, next) => {
   *   c.set('message', 'Hono is hot!!')
   *   await next()
   * })
   * ```
   */
  set = /* @__PURE__ */ __name((key, value) => {
    this.#var ??= /* @__PURE__ */ new Map();
    this.#var.set(key, value);
  }, "set");
  /**
   * `.get()` can use the value specified by the key.
   *
   * @see {@link https://hono.dev/docs/api/context#set-get}
   *
   * @example
   * ```ts
   * app.get('/', (c) => {
   *   const message = c.get('message')
   *   return c.text(`The message is "${message}"`)
   * })
   * ```
   */
  get = /* @__PURE__ */ __name((key) => {
    return this.#var ? this.#var.get(key) : void 0;
  }, "get");
  /**
   * `.var` can access the value of a variable.
   *
   * @see {@link https://hono.dev/docs/api/context#var}
   *
   * @example
   * ```ts
   * const result = c.var.client.oneMethod()
   * ```
   */
  // c.var.propName is a read-only
  get var() {
    if (!this.#var) {
      return {};
    }
    return Object.fromEntries(this.#var);
  }
  #newResponse(data, arg, headers) {
    const responseHeaders = this.#res ? new Headers(this.#res.headers) : this.#preparedHeaders ?? new Headers();
    if (typeof arg === "object" && "headers" in arg) {
      const argHeaders = arg.headers instanceof Headers ? arg.headers : new Headers(arg.headers);
      for (const [key, value] of argHeaders) {
        if (key.toLowerCase() === "set-cookie") {
          responseHeaders.append(key, value);
        } else {
          responseHeaders.set(key, value);
        }
      }
    }
    if (headers) {
      for (const [k, v] of Object.entries(headers)) {
        if (typeof v === "string") {
          responseHeaders.set(k, v);
        } else {
          responseHeaders.delete(k);
          for (const v2 of v) {
            responseHeaders.append(k, v2);
          }
        }
      }
    }
    const status = typeof arg === "number" ? arg : arg?.status ?? this.#status;
    return createResponseInstance(data, { status, headers: responseHeaders });
  }
  newResponse = /* @__PURE__ */ __name((...args) => this.#newResponse(...args), "newResponse");
  /**
   * `.body()` can return the HTTP response.
   * You can set headers with `.header()` and set HTTP status code with `.status`.
   * This can also be set in `.text()`, `.json()` and so on.
   *
   * @see {@link https://hono.dev/docs/api/context#body}
   *
   * @example
   * ```ts
   * app.get('/welcome', (c) => {
   *   // Set headers
   *   c.header('X-Message', 'Hello!')
   *   c.header('Content-Type', 'text/plain')
   *   // Set HTTP status code
   *   c.status(201)
   *
   *   // Return the response body
   *   return c.body('Thank you for coming')
   * })
   * ```
   */
  body = /* @__PURE__ */ __name((data, arg, headers) => this.#newResponse(data, arg, headers), "body");
  /**
   * `.text()` can render text as `Content-Type:text/plain`.
   *
   * @see {@link https://hono.dev/docs/api/context#text}
   *
   * @example
   * ```ts
   * app.get('/say', (c) => {
   *   return c.text('Hello!')
   * })
   * ```
   */
  text = /* @__PURE__ */ __name((text, arg, headers) => {
    return !this.#preparedHeaders && !this.#status && !arg && !headers && !this.finalized ? new Response(text) : this.#newResponse(
      text,
      arg,
      setDefaultContentType(TEXT_PLAIN, headers)
    );
  }, "text");
  /**
   * `.json()` can render JSON as `Content-Type:application/json`.
   *
   * @see {@link https://hono.dev/docs/api/context#json}
   *
   * @example
   * ```ts
   * app.get('/api', (c) => {
   *   return c.json({ message: 'Hello!' })
   * })
   * ```
   */
  json = /* @__PURE__ */ __name((object, arg, headers) => {
    return this.#newResponse(
      JSON.stringify(object),
      arg,
      setDefaultContentType("application/json", headers)
    );
  }, "json");
  html = /* @__PURE__ */ __name((html, arg, headers) => {
    const res = /* @__PURE__ */ __name((html2) => this.#newResponse(html2, arg, setDefaultContentType("text/html; charset=UTF-8", headers)), "res");
    return typeof html === "object" ? resolveCallback(html, HtmlEscapedCallbackPhase.Stringify, false, {}).then(res) : res(html);
  }, "html");
  /**
   * `.redirect()` can Redirect, default status code is 302.
   *
   * @see {@link https://hono.dev/docs/api/context#redirect}
   *
   * @example
   * ```ts
   * app.get('/redirect', (c) => {
   *   return c.redirect('/')
   * })
   * app.get('/redirect-permanently', (c) => {
   *   return c.redirect('/', 301)
   * })
   * ```
   */
  redirect = /* @__PURE__ */ __name((location, status) => {
    const locationString = String(location);
    this.header(
      "Location",
      // Multibyes should be encoded
      // eslint-disable-next-line no-control-regex
      !/[^\x00-\xFF]/.test(locationString) ? locationString : encodeURI(locationString)
    );
    return this.newResponse(null, status ?? 302);
  }, "redirect");
  /**
   * `.notFound()` can return the Not Found Response.
   *
   * @see {@link https://hono.dev/docs/api/context#notfound}
   *
   * @example
   * ```ts
   * app.get('/notfound', (c) => {
   *   return c.notFound()
   * })
   * ```
   */
  notFound = /* @__PURE__ */ __name(() => {
    this.#notFoundHandler ??= () => createResponseInstance();
    return this.#notFoundHandler(this);
  }, "notFound");
};

// node_modules/.pnpm/hono@4.12.12/node_modules/hono/dist/router.js
var METHOD_NAME_ALL = "ALL";
var METHOD_NAME_ALL_LOWERCASE = "all";
var METHODS = ["get", "post", "put", "delete", "options", "patch"];
var MESSAGE_MATCHER_IS_ALREADY_BUILT = "Can not add a route since the matcher is already built.";
var UnsupportedPathError = class extends Error {
  static {
    __name(this, "UnsupportedPathError");
  }
};

// node_modules/.pnpm/hono@4.12.12/node_modules/hono/dist/utils/constants.js
var COMPOSED_HANDLER = "__COMPOSED_HANDLER";

// node_modules/.pnpm/hono@4.12.12/node_modules/hono/dist/hono-base.js
var notFoundHandler = /* @__PURE__ */ __name((c) => {
  return c.text("404 Not Found", 404);
}, "notFoundHandler");
var errorHandler = /* @__PURE__ */ __name((err, c) => {
  if ("getResponse" in err) {
    const res = err.getResponse();
    return c.newResponse(res.body, res);
  }
  console.error(err);
  return c.text("Internal Server Error", 500);
}, "errorHandler");
var Hono = class _Hono {
  static {
    __name(this, "_Hono");
  }
  get;
  post;
  put;
  delete;
  options;
  patch;
  all;
  on;
  use;
  /*
    This class is like an abstract class and does not have a router.
    To use it, inherit the class and implement router in the constructor.
  */
  router;
  getPath;
  // Cannot use `#` because it requires visibility at JavaScript runtime.
  _basePath = "/";
  #path = "/";
  routes = [];
  constructor(options = {}) {
    const allMethods = [...METHODS, METHOD_NAME_ALL_LOWERCASE];
    allMethods.forEach((method) => {
      this[method] = (args1, ...args) => {
        if (typeof args1 === "string") {
          this.#path = args1;
        } else {
          this.#addRoute(method, this.#path, args1);
        }
        args.forEach((handler) => {
          this.#addRoute(method, this.#path, handler);
        });
        return this;
      };
    });
    this.on = (method, path, ...handlers) => {
      for (const p of [path].flat()) {
        this.#path = p;
        for (const m of [method].flat()) {
          handlers.map((handler) => {
            this.#addRoute(m.toUpperCase(), this.#path, handler);
          });
        }
      }
      return this;
    };
    this.use = (arg1, ...handlers) => {
      if (typeof arg1 === "string") {
        this.#path = arg1;
      } else {
        this.#path = "*";
        handlers.unshift(arg1);
      }
      handlers.forEach((handler) => {
        this.#addRoute(METHOD_NAME_ALL, this.#path, handler);
      });
      return this;
    };
    const { strict, ...optionsWithoutStrict } = options;
    Object.assign(this, optionsWithoutStrict);
    this.getPath = strict ?? true ? options.getPath ?? getPath : getPathNoStrict;
  }
  #clone() {
    const clone = new _Hono({
      router: this.router,
      getPath: this.getPath
    });
    clone.errorHandler = this.errorHandler;
    clone.#notFoundHandler = this.#notFoundHandler;
    clone.routes = this.routes;
    return clone;
  }
  #notFoundHandler = notFoundHandler;
  // Cannot use `#` because it requires visibility at JavaScript runtime.
  errorHandler = errorHandler;
  /**
   * `.route()` allows grouping other Hono instance in routes.
   *
   * @see {@link https://hono.dev/docs/api/routing#grouping}
   *
   * @param {string} path - base Path
   * @param {Hono} app - other Hono instance
   * @returns {Hono} routed Hono instance
   *
   * @example
   * ```ts
   * const app = new Hono()
   * const app2 = new Hono()
   *
   * app2.get("/user", (c) => c.text("user"))
   * app.route("/api", app2) // GET /api/user
   * ```
   */
  route(path, app2) {
    const subApp = this.basePath(path);
    app2.routes.map((r) => {
      let handler;
      if (app2.errorHandler === errorHandler) {
        handler = r.handler;
      } else {
        handler = /* @__PURE__ */ __name(async (c, next) => (await compose([], app2.errorHandler)(c, () => r.handler(c, next))).res, "handler");
        handler[COMPOSED_HANDLER] = r.handler;
      }
      subApp.#addRoute(r.method, r.path, handler);
    });
    return this;
  }
  /**
   * `.basePath()` allows base paths to be specified.
   *
   * @see {@link https://hono.dev/docs/api/routing#base-path}
   *
   * @param {string} path - base Path
   * @returns {Hono} changed Hono instance
   *
   * @example
   * ```ts
   * const api = new Hono().basePath('/api')
   * ```
   */
  basePath(path) {
    const subApp = this.#clone();
    subApp._basePath = mergePath(this._basePath, path);
    return subApp;
  }
  /**
   * `.onError()` handles an error and returns a customized Response.
   *
   * @see {@link https://hono.dev/docs/api/hono#error-handling}
   *
   * @param {ErrorHandler} handler - request Handler for error
   * @returns {Hono} changed Hono instance
   *
   * @example
   * ```ts
   * app.onError((err, c) => {
   *   console.error(`${err}`)
   *   return c.text('Custom Error Message', 500)
   * })
   * ```
   */
  onError = /* @__PURE__ */ __name((handler) => {
    this.errorHandler = handler;
    return this;
  }, "onError");
  /**
   * `.notFound()` allows you to customize a Not Found Response.
   *
   * @see {@link https://hono.dev/docs/api/hono#not-found}
   *
   * @param {NotFoundHandler} handler - request handler for not-found
   * @returns {Hono} changed Hono instance
   *
   * @example
   * ```ts
   * app.notFound((c) => {
   *   return c.text('Custom 404 Message', 404)
   * })
   * ```
   */
  notFound = /* @__PURE__ */ __name((handler) => {
    this.#notFoundHandler = handler;
    return this;
  }, "notFound");
  /**
   * `.mount()` allows you to mount applications built with other frameworks into your Hono application.
   *
   * @see {@link https://hono.dev/docs/api/hono#mount}
   *
   * @param {string} path - base Path
   * @param {Function} applicationHandler - other Request Handler
   * @param {MountOptions} [options] - options of `.mount()`
   * @returns {Hono} mounted Hono instance
   *
   * @example
   * ```ts
   * import { Router as IttyRouter } from 'itty-router'
   * import { Hono } from 'hono'
   * // Create itty-router application
   * const ittyRouter = IttyRouter()
   * // GET /itty-router/hello
   * ittyRouter.get('/hello', () => new Response('Hello from itty-router'))
   *
   * const app = new Hono()
   * app.mount('/itty-router', ittyRouter.handle)
   * ```
   *
   * @example
   * ```ts
   * const app = new Hono()
   * // Send the request to another application without modification.
   * app.mount('/app', anotherApp, {
   *   replaceRequest: (req) => req,
   * })
   * ```
   */
  mount(path, applicationHandler, options) {
    let replaceRequest;
    let optionHandler;
    if (options) {
      if (typeof options === "function") {
        optionHandler = options;
      } else {
        optionHandler = options.optionHandler;
        if (options.replaceRequest === false) {
          replaceRequest = /* @__PURE__ */ __name((request) => request, "replaceRequest");
        } else {
          replaceRequest = options.replaceRequest;
        }
      }
    }
    const getOptions = optionHandler ? (c) => {
      const options2 = optionHandler(c);
      return Array.isArray(options2) ? options2 : [options2];
    } : (c) => {
      let executionContext = void 0;
      try {
        executionContext = c.executionCtx;
      } catch {
      }
      return [c.env, executionContext];
    };
    replaceRequest ||= (() => {
      const mergedPath = mergePath(this._basePath, path);
      const pathPrefixLength = mergedPath === "/" ? 0 : mergedPath.length;
      return (request) => {
        const url = new URL(request.url);
        url.pathname = url.pathname.slice(pathPrefixLength) || "/";
        return new Request(url, request);
      };
    })();
    const handler = /* @__PURE__ */ __name(async (c, next) => {
      const res = await applicationHandler(replaceRequest(c.req.raw), ...getOptions(c));
      if (res) {
        return res;
      }
      await next();
    }, "handler");
    this.#addRoute(METHOD_NAME_ALL, mergePath(path, "*"), handler);
    return this;
  }
  #addRoute(method, path, handler) {
    method = method.toUpperCase();
    path = mergePath(this._basePath, path);
    const r = { basePath: this._basePath, path, method, handler };
    this.router.add(method, path, [handler, r]);
    this.routes.push(r);
  }
  #handleError(err, c) {
    if (err instanceof Error) {
      return this.errorHandler(err, c);
    }
    throw err;
  }
  #dispatch(request, executionCtx, env, method) {
    if (method === "HEAD") {
      return (async () => new Response(null, await this.#dispatch(request, executionCtx, env, "GET")))();
    }
    const path = this.getPath(request, { env });
    const matchResult = this.router.match(method, path);
    const c = new Context(request, {
      path,
      matchResult,
      env,
      executionCtx,
      notFoundHandler: this.#notFoundHandler
    });
    if (matchResult[0].length === 1) {
      let res;
      try {
        res = matchResult[0][0][0][0](c, async () => {
          c.res = await this.#notFoundHandler(c);
        });
      } catch (err) {
        return this.#handleError(err, c);
      }
      return res instanceof Promise ? res.then(
        (resolved) => resolved || (c.finalized ? c.res : this.#notFoundHandler(c))
      ).catch((err) => this.#handleError(err, c)) : res ?? this.#notFoundHandler(c);
    }
    const composed = compose(matchResult[0], this.errorHandler, this.#notFoundHandler);
    return (async () => {
      try {
        const context = await composed(c);
        if (!context.finalized) {
          throw new Error(
            "Context is not finalized. Did you forget to return a Response object or `await next()`?"
          );
        }
        return context.res;
      } catch (err) {
        return this.#handleError(err, c);
      }
    })();
  }
  /**
   * `.fetch()` will be entry point of your app.
   *
   * @see {@link https://hono.dev/docs/api/hono#fetch}
   *
   * @param {Request} request - request Object of request
   * @param {Env} Env - env Object
   * @param {ExecutionContext} - context of execution
   * @returns {Response | Promise<Response>} response of request
   *
   */
  fetch = /* @__PURE__ */ __name((request, ...rest) => {
    return this.#dispatch(request, rest[1], rest[0], request.method);
  }, "fetch");
  /**
   * `.request()` is a useful method for testing.
   * You can pass a URL or pathname to send a GET request.
   * app will return a Response object.
   * ```ts
   * test('GET /hello is ok', async () => {
   *   const res = await app.request('/hello')
   *   expect(res.status).toBe(200)
   * })
   * ```
   * @see https://hono.dev/docs/api/hono#request
   */
  request = /* @__PURE__ */ __name((input, requestInit, Env, executionCtx) => {
    if (input instanceof Request) {
      return this.fetch(requestInit ? new Request(input, requestInit) : input, Env, executionCtx);
    }
    input = input.toString();
    return this.fetch(
      new Request(
        /^https?:\/\//.test(input) ? input : `http://localhost${mergePath("/", input)}`,
        requestInit
      ),
      Env,
      executionCtx
    );
  }, "request");
  /**
   * `.fire()` automatically adds a global fetch event listener.
   * This can be useful for environments that adhere to the Service Worker API, such as non-ES module Cloudflare Workers.
   * @deprecated
   * Use `fire` from `hono/service-worker` instead.
   * ```ts
   * import { Hono } from 'hono'
   * import { fire } from 'hono/service-worker'
   *
   * const app = new Hono()
   * // ...
   * fire(app)
   * ```
   * @see https://hono.dev/docs/api/hono#fire
   * @see https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API
   * @see https://developers.cloudflare.com/workers/reference/migrate-to-module-workers/
   */
  fire = /* @__PURE__ */ __name(() => {
    addEventListener("fetch", (event) => {
      event.respondWith(this.#dispatch(event.request, event, void 0, event.request.method));
    });
  }, "fire");
};

// node_modules/.pnpm/hono@4.12.12/node_modules/hono/dist/router/reg-exp-router/matcher.js
var emptyParam = [];
function match(method, path) {
  const matchers = this.buildAllMatchers();
  const match2 = /* @__PURE__ */ __name(((method2, path2) => {
    const matcher = matchers[method2] || matchers[METHOD_NAME_ALL];
    const staticMatch = matcher[2][path2];
    if (staticMatch) {
      return staticMatch;
    }
    const match3 = path2.match(matcher[0]);
    if (!match3) {
      return [[], emptyParam];
    }
    const index = match3.indexOf("", 1);
    return [matcher[1][index], match3];
  }), "match2");
  this.match = match2;
  return match2(method, path);
}
__name(match, "match");

// node_modules/.pnpm/hono@4.12.12/node_modules/hono/dist/router/reg-exp-router/node.js
var LABEL_REG_EXP_STR = "[^/]+";
var ONLY_WILDCARD_REG_EXP_STR = ".*";
var TAIL_WILDCARD_REG_EXP_STR = "(?:|/.*)";
var PATH_ERROR = /* @__PURE__ */ Symbol();
var regExpMetaChars = new Set(".\\+*[^]$()");
function compareKey(a, b) {
  if (a.length === 1) {
    return b.length === 1 ? a < b ? -1 : 1 : -1;
  }
  if (b.length === 1) {
    return 1;
  }
  if (a === ONLY_WILDCARD_REG_EXP_STR || a === TAIL_WILDCARD_REG_EXP_STR) {
    return 1;
  } else if (b === ONLY_WILDCARD_REG_EXP_STR || b === TAIL_WILDCARD_REG_EXP_STR) {
    return -1;
  }
  if (a === LABEL_REG_EXP_STR) {
    return 1;
  } else if (b === LABEL_REG_EXP_STR) {
    return -1;
  }
  return a.length === b.length ? a < b ? -1 : 1 : b.length - a.length;
}
__name(compareKey, "compareKey");
var Node = class _Node {
  static {
    __name(this, "_Node");
  }
  #index;
  #varIndex;
  #children = /* @__PURE__ */ Object.create(null);
  insert(tokens, index, paramMap, context, pathErrorCheckOnly) {
    if (tokens.length === 0) {
      if (this.#index !== void 0) {
        throw PATH_ERROR;
      }
      if (pathErrorCheckOnly) {
        return;
      }
      this.#index = index;
      return;
    }
    const [token, ...restTokens] = tokens;
    const pattern = token === "*" ? restTokens.length === 0 ? ["", "", ONLY_WILDCARD_REG_EXP_STR] : ["", "", LABEL_REG_EXP_STR] : token === "/*" ? ["", "", TAIL_WILDCARD_REG_EXP_STR] : token.match(/^\:([^\{\}]+)(?:\{(.+)\})?$/);
    let node;
    if (pattern) {
      const name = pattern[1];
      let regexpStr = pattern[2] || LABEL_REG_EXP_STR;
      if (name && pattern[2]) {
        if (regexpStr === ".*") {
          throw PATH_ERROR;
        }
        regexpStr = regexpStr.replace(/^\((?!\?:)(?=[^)]+\)$)/, "(?:");
        if (/\((?!\?:)/.test(regexpStr)) {
          throw PATH_ERROR;
        }
      }
      node = this.#children[regexpStr];
      if (!node) {
        if (Object.keys(this.#children).some(
          (k) => k !== ONLY_WILDCARD_REG_EXP_STR && k !== TAIL_WILDCARD_REG_EXP_STR
        )) {
          throw PATH_ERROR;
        }
        if (pathErrorCheckOnly) {
          return;
        }
        node = this.#children[regexpStr] = new _Node();
        if (name !== "") {
          node.#varIndex = context.varIndex++;
        }
      }
      if (!pathErrorCheckOnly && name !== "") {
        paramMap.push([name, node.#varIndex]);
      }
    } else {
      node = this.#children[token];
      if (!node) {
        if (Object.keys(this.#children).some(
          (k) => k.length > 1 && k !== ONLY_WILDCARD_REG_EXP_STR && k !== TAIL_WILDCARD_REG_EXP_STR
        )) {
          throw PATH_ERROR;
        }
        if (pathErrorCheckOnly) {
          return;
        }
        node = this.#children[token] = new _Node();
      }
    }
    node.insert(restTokens, index, paramMap, context, pathErrorCheckOnly);
  }
  buildRegExpStr() {
    const childKeys = Object.keys(this.#children).sort(compareKey);
    const strList = childKeys.map((k) => {
      const c = this.#children[k];
      return (typeof c.#varIndex === "number" ? `(${k})@${c.#varIndex}` : regExpMetaChars.has(k) ? `\\${k}` : k) + c.buildRegExpStr();
    });
    if (typeof this.#index === "number") {
      strList.unshift(`#${this.#index}`);
    }
    if (strList.length === 0) {
      return "";
    }
    if (strList.length === 1) {
      return strList[0];
    }
    return "(?:" + strList.join("|") + ")";
  }
};

// node_modules/.pnpm/hono@4.12.12/node_modules/hono/dist/router/reg-exp-router/trie.js
var Trie = class {
  static {
    __name(this, "Trie");
  }
  #context = { varIndex: 0 };
  #root = new Node();
  insert(path, index, pathErrorCheckOnly) {
    const paramAssoc = [];
    const groups = [];
    for (let i = 0; ; ) {
      let replaced = false;
      path = path.replace(/\{[^}]+\}/g, (m) => {
        const mark = `@\\${i}`;
        groups[i] = [mark, m];
        i++;
        replaced = true;
        return mark;
      });
      if (!replaced) {
        break;
      }
    }
    const tokens = path.match(/(?::[^\/]+)|(?:\/\*$)|./g) || [];
    for (let i = groups.length - 1; i >= 0; i--) {
      const [mark] = groups[i];
      for (let j = tokens.length - 1; j >= 0; j--) {
        if (tokens[j].indexOf(mark) !== -1) {
          tokens[j] = tokens[j].replace(mark, groups[i][1]);
          break;
        }
      }
    }
    this.#root.insert(tokens, index, paramAssoc, this.#context, pathErrorCheckOnly);
    return paramAssoc;
  }
  buildRegExp() {
    let regexp = this.#root.buildRegExpStr();
    if (regexp === "") {
      return [/^$/, [], []];
    }
    let captureIndex = 0;
    const indexReplacementMap = [];
    const paramReplacementMap = [];
    regexp = regexp.replace(/#(\d+)|@(\d+)|\.\*\$/g, (_, handlerIndex, paramIndex) => {
      if (handlerIndex !== void 0) {
        indexReplacementMap[++captureIndex] = Number(handlerIndex);
        return "$()";
      }
      if (paramIndex !== void 0) {
        paramReplacementMap[Number(paramIndex)] = ++captureIndex;
        return "";
      }
      return "";
    });
    return [new RegExp(`^${regexp}`), indexReplacementMap, paramReplacementMap];
  }
};

// node_modules/.pnpm/hono@4.12.12/node_modules/hono/dist/router/reg-exp-router/router.js
var nullMatcher = [/^$/, [], /* @__PURE__ */ Object.create(null)];
var wildcardRegExpCache = /* @__PURE__ */ Object.create(null);
function buildWildcardRegExp(path) {
  return wildcardRegExpCache[path] ??= new RegExp(
    path === "*" ? "" : `^${path.replace(
      /\/\*$|([.\\+*[^\]$()])/g,
      (_, metaChar) => metaChar ? `\\${metaChar}` : "(?:|/.*)"
    )}$`
  );
}
__name(buildWildcardRegExp, "buildWildcardRegExp");
function clearWildcardRegExpCache() {
  wildcardRegExpCache = /* @__PURE__ */ Object.create(null);
}
__name(clearWildcardRegExpCache, "clearWildcardRegExpCache");
function buildMatcherFromPreprocessedRoutes(routes) {
  const trie = new Trie();
  const handlerData = [];
  if (routes.length === 0) {
    return nullMatcher;
  }
  const routesWithStaticPathFlag = routes.map(
    (route) => [!/\*|\/:/.test(route[0]), ...route]
  ).sort(
    ([isStaticA, pathA], [isStaticB, pathB]) => isStaticA ? 1 : isStaticB ? -1 : pathA.length - pathB.length
  );
  const staticMap = /* @__PURE__ */ Object.create(null);
  for (let i = 0, j = -1, len = routesWithStaticPathFlag.length; i < len; i++) {
    const [pathErrorCheckOnly, path, handlers] = routesWithStaticPathFlag[i];
    if (pathErrorCheckOnly) {
      staticMap[path] = [handlers.map(([h]) => [h, /* @__PURE__ */ Object.create(null)]), emptyParam];
    } else {
      j++;
    }
    let paramAssoc;
    try {
      paramAssoc = trie.insert(path, j, pathErrorCheckOnly);
    } catch (e) {
      throw e === PATH_ERROR ? new UnsupportedPathError(path) : e;
    }
    if (pathErrorCheckOnly) {
      continue;
    }
    handlerData[j] = handlers.map(([h, paramCount]) => {
      const paramIndexMap = /* @__PURE__ */ Object.create(null);
      paramCount -= 1;
      for (; paramCount >= 0; paramCount--) {
        const [key, value] = paramAssoc[paramCount];
        paramIndexMap[key] = value;
      }
      return [h, paramIndexMap];
    });
  }
  const [regexp, indexReplacementMap, paramReplacementMap] = trie.buildRegExp();
  for (let i = 0, len = handlerData.length; i < len; i++) {
    for (let j = 0, len2 = handlerData[i].length; j < len2; j++) {
      const map = handlerData[i][j]?.[1];
      if (!map) {
        continue;
      }
      const keys = Object.keys(map);
      for (let k = 0, len3 = keys.length; k < len3; k++) {
        map[keys[k]] = paramReplacementMap[map[keys[k]]];
      }
    }
  }
  const handlerMap = [];
  for (const i in indexReplacementMap) {
    handlerMap[i] = handlerData[indexReplacementMap[i]];
  }
  return [regexp, handlerMap, staticMap];
}
__name(buildMatcherFromPreprocessedRoutes, "buildMatcherFromPreprocessedRoutes");
function findMiddleware(middleware, path) {
  if (!middleware) {
    return void 0;
  }
  for (const k of Object.keys(middleware).sort((a, b) => b.length - a.length)) {
    if (buildWildcardRegExp(k).test(path)) {
      return [...middleware[k]];
    }
  }
  return void 0;
}
__name(findMiddleware, "findMiddleware");
var RegExpRouter = class {
  static {
    __name(this, "RegExpRouter");
  }
  name = "RegExpRouter";
  #middleware;
  #routes;
  constructor() {
    this.#middleware = { [METHOD_NAME_ALL]: /* @__PURE__ */ Object.create(null) };
    this.#routes = { [METHOD_NAME_ALL]: /* @__PURE__ */ Object.create(null) };
  }
  add(method, path, handler) {
    const middleware = this.#middleware;
    const routes = this.#routes;
    if (!middleware || !routes) {
      throw new Error(MESSAGE_MATCHER_IS_ALREADY_BUILT);
    }
    if (!middleware[method]) {
      ;
      [middleware, routes].forEach((handlerMap) => {
        handlerMap[method] = /* @__PURE__ */ Object.create(null);
        Object.keys(handlerMap[METHOD_NAME_ALL]).forEach((p) => {
          handlerMap[method][p] = [...handlerMap[METHOD_NAME_ALL][p]];
        });
      });
    }
    if (path === "/*") {
      path = "*";
    }
    const paramCount = (path.match(/\/:/g) || []).length;
    if (/\*$/.test(path)) {
      const re = buildWildcardRegExp(path);
      if (method === METHOD_NAME_ALL) {
        Object.keys(middleware).forEach((m) => {
          middleware[m][path] ||= findMiddleware(middleware[m], path) || findMiddleware(middleware[METHOD_NAME_ALL], path) || [];
        });
      } else {
        middleware[method][path] ||= findMiddleware(middleware[method], path) || findMiddleware(middleware[METHOD_NAME_ALL], path) || [];
      }
      Object.keys(middleware).forEach((m) => {
        if (method === METHOD_NAME_ALL || method === m) {
          Object.keys(middleware[m]).forEach((p) => {
            re.test(p) && middleware[m][p].push([handler, paramCount]);
          });
        }
      });
      Object.keys(routes).forEach((m) => {
        if (method === METHOD_NAME_ALL || method === m) {
          Object.keys(routes[m]).forEach(
            (p) => re.test(p) && routes[m][p].push([handler, paramCount])
          );
        }
      });
      return;
    }
    const paths = checkOptionalParameter(path) || [path];
    for (let i = 0, len = paths.length; i < len; i++) {
      const path2 = paths[i];
      Object.keys(routes).forEach((m) => {
        if (method === METHOD_NAME_ALL || method === m) {
          routes[m][path2] ||= [
            ...findMiddleware(middleware[m], path2) || findMiddleware(middleware[METHOD_NAME_ALL], path2) || []
          ];
          routes[m][path2].push([handler, paramCount - len + i + 1]);
        }
      });
    }
  }
  match = match;
  buildAllMatchers() {
    const matchers = /* @__PURE__ */ Object.create(null);
    Object.keys(this.#routes).concat(Object.keys(this.#middleware)).forEach((method) => {
      matchers[method] ||= this.#buildMatcher(method);
    });
    this.#middleware = this.#routes = void 0;
    clearWildcardRegExpCache();
    return matchers;
  }
  #buildMatcher(method) {
    const routes = [];
    let hasOwnRoute = method === METHOD_NAME_ALL;
    [this.#middleware, this.#routes].forEach((r) => {
      const ownRoute = r[method] ? Object.keys(r[method]).map((path) => [path, r[method][path]]) : [];
      if (ownRoute.length !== 0) {
        hasOwnRoute ||= true;
        routes.push(...ownRoute);
      } else if (method !== METHOD_NAME_ALL) {
        routes.push(
          ...Object.keys(r[METHOD_NAME_ALL]).map((path) => [path, r[METHOD_NAME_ALL][path]])
        );
      }
    });
    if (!hasOwnRoute) {
      return null;
    } else {
      return buildMatcherFromPreprocessedRoutes(routes);
    }
  }
};

// node_modules/.pnpm/hono@4.12.12/node_modules/hono/dist/router/smart-router/router.js
var SmartRouter = class {
  static {
    __name(this, "SmartRouter");
  }
  name = "SmartRouter";
  #routers = [];
  #routes = [];
  constructor(init) {
    this.#routers = init.routers;
  }
  add(method, path, handler) {
    if (!this.#routes) {
      throw new Error(MESSAGE_MATCHER_IS_ALREADY_BUILT);
    }
    this.#routes.push([method, path, handler]);
  }
  match(method, path) {
    if (!this.#routes) {
      throw new Error("Fatal error");
    }
    const routers = this.#routers;
    const routes = this.#routes;
    const len = routers.length;
    let i = 0;
    let res;
    for (; i < len; i++) {
      const router = routers[i];
      try {
        for (let i2 = 0, len2 = routes.length; i2 < len2; i2++) {
          router.add(...routes[i2]);
        }
        res = router.match(method, path);
      } catch (e) {
        if (e instanceof UnsupportedPathError) {
          continue;
        }
        throw e;
      }
      this.match = router.match.bind(router);
      this.#routers = [router];
      this.#routes = void 0;
      break;
    }
    if (i === len) {
      throw new Error("Fatal error");
    }
    this.name = `SmartRouter + ${this.activeRouter.name}`;
    return res;
  }
  get activeRouter() {
    if (this.#routes || this.#routers.length !== 1) {
      throw new Error("No active router has been determined yet.");
    }
    return this.#routers[0];
  }
};

// node_modules/.pnpm/hono@4.12.12/node_modules/hono/dist/router/trie-router/node.js
var emptyParams = /* @__PURE__ */ Object.create(null);
var hasChildren = /* @__PURE__ */ __name((children) => {
  for (const _ in children) {
    return true;
  }
  return false;
}, "hasChildren");
var Node2 = class _Node2 {
  static {
    __name(this, "_Node");
  }
  #methods;
  #children;
  #patterns;
  #order = 0;
  #params = emptyParams;
  constructor(method, handler, children) {
    this.#children = children || /* @__PURE__ */ Object.create(null);
    this.#methods = [];
    if (method && handler) {
      const m = /* @__PURE__ */ Object.create(null);
      m[method] = { handler, possibleKeys: [], score: 0 };
      this.#methods = [m];
    }
    this.#patterns = [];
  }
  insert(method, path, handler) {
    this.#order = ++this.#order;
    let curNode = this;
    const parts = splitRoutingPath(path);
    const possibleKeys = [];
    for (let i = 0, len = parts.length; i < len; i++) {
      const p = parts[i];
      const nextP = parts[i + 1];
      const pattern = getPattern(p, nextP);
      const key = Array.isArray(pattern) ? pattern[0] : p;
      if (key in curNode.#children) {
        curNode = curNode.#children[key];
        if (pattern) {
          possibleKeys.push(pattern[1]);
        }
        continue;
      }
      curNode.#children[key] = new _Node2();
      if (pattern) {
        curNode.#patterns.push(pattern);
        possibleKeys.push(pattern[1]);
      }
      curNode = curNode.#children[key];
    }
    curNode.#methods.push({
      [method]: {
        handler,
        possibleKeys: possibleKeys.filter((v, i, a) => a.indexOf(v) === i),
        score: this.#order
      }
    });
    return curNode;
  }
  #pushHandlerSets(handlerSets, node, method, nodeParams, params) {
    for (let i = 0, len = node.#methods.length; i < len; i++) {
      const m = node.#methods[i];
      const handlerSet = m[method] || m[METHOD_NAME_ALL];
      const processedSet = {};
      if (handlerSet !== void 0) {
        handlerSet.params = /* @__PURE__ */ Object.create(null);
        handlerSets.push(handlerSet);
        if (nodeParams !== emptyParams || params && params !== emptyParams) {
          for (let i2 = 0, len2 = handlerSet.possibleKeys.length; i2 < len2; i2++) {
            const key = handlerSet.possibleKeys[i2];
            const processed = processedSet[handlerSet.score];
            handlerSet.params[key] = params?.[key] && !processed ? params[key] : nodeParams[key] ?? params?.[key];
            processedSet[handlerSet.score] = true;
          }
        }
      }
    }
  }
  search(method, path) {
    const handlerSets = [];
    this.#params = emptyParams;
    const curNode = this;
    let curNodes = [curNode];
    const parts = splitPath(path);
    const curNodesQueue = [];
    const len = parts.length;
    let partOffsets = null;
    for (let i = 0; i < len; i++) {
      const part = parts[i];
      const isLast = i === len - 1;
      const tempNodes = [];
      for (let j = 0, len2 = curNodes.length; j < len2; j++) {
        const node = curNodes[j];
        const nextNode = node.#children[part];
        if (nextNode) {
          nextNode.#params = node.#params;
          if (isLast) {
            if (nextNode.#children["*"]) {
              this.#pushHandlerSets(handlerSets, nextNode.#children["*"], method, node.#params);
            }
            this.#pushHandlerSets(handlerSets, nextNode, method, node.#params);
          } else {
            tempNodes.push(nextNode);
          }
        }
        for (let k = 0, len3 = node.#patterns.length; k < len3; k++) {
          const pattern = node.#patterns[k];
          const params = node.#params === emptyParams ? {} : { ...node.#params };
          if (pattern === "*") {
            const astNode = node.#children["*"];
            if (astNode) {
              this.#pushHandlerSets(handlerSets, astNode, method, node.#params);
              astNode.#params = params;
              tempNodes.push(astNode);
            }
            continue;
          }
          const [key, name, matcher] = pattern;
          if (!part && !(matcher instanceof RegExp)) {
            continue;
          }
          const child = node.#children[key];
          if (matcher instanceof RegExp) {
            if (partOffsets === null) {
              partOffsets = new Array(len);
              let offset = path[0] === "/" ? 1 : 0;
              for (let p = 0; p < len; p++) {
                partOffsets[p] = offset;
                offset += parts[p].length + 1;
              }
            }
            const restPathString = path.substring(partOffsets[i]);
            const m = matcher.exec(restPathString);
            if (m) {
              params[name] = m[0];
              this.#pushHandlerSets(handlerSets, child, method, node.#params, params);
              if (hasChildren(child.#children)) {
                child.#params = params;
                const componentCount = m[0].match(/\//)?.length ?? 0;
                const targetCurNodes = curNodesQueue[componentCount] ||= [];
                targetCurNodes.push(child);
              }
              continue;
            }
          }
          if (matcher === true || matcher.test(part)) {
            params[name] = part;
            if (isLast) {
              this.#pushHandlerSets(handlerSets, child, method, params, node.#params);
              if (child.#children["*"]) {
                this.#pushHandlerSets(
                  handlerSets,
                  child.#children["*"],
                  method,
                  params,
                  node.#params
                );
              }
            } else {
              child.#params = params;
              tempNodes.push(child);
            }
          }
        }
      }
      const shifted = curNodesQueue.shift();
      curNodes = shifted ? tempNodes.concat(shifted) : tempNodes;
    }
    if (handlerSets.length > 1) {
      handlerSets.sort((a, b) => {
        return a.score - b.score;
      });
    }
    return [handlerSets.map(({ handler, params }) => [handler, params])];
  }
};

// node_modules/.pnpm/hono@4.12.12/node_modules/hono/dist/router/trie-router/router.js
var TrieRouter = class {
  static {
    __name(this, "TrieRouter");
  }
  name = "TrieRouter";
  #node;
  constructor() {
    this.#node = new Node2();
  }
  add(method, path, handler) {
    const results = checkOptionalParameter(path);
    if (results) {
      for (let i = 0, len = results.length; i < len; i++) {
        this.#node.insert(method, results[i], handler);
      }
      return;
    }
    this.#node.insert(method, path, handler);
  }
  match(method, path) {
    return this.#node.search(method, path);
  }
};

// node_modules/.pnpm/hono@4.12.12/node_modules/hono/dist/hono.js
var Hono2 = class extends Hono {
  static {
    __name(this, "Hono");
  }
  /**
   * Creates an instance of the Hono class.
   *
   * @param options - Optional configuration options for the Hono instance.
   */
  constructor(options = {}) {
    super(options);
    this.router = options.router ?? new SmartRouter({
      routers: [new RegExpRouter(), new TrieRouter()]
    });
  }
};

// src/app/routes.ts
var ACTIVE_ROUTES = [
  "GET /",
  "GET /health",
  "GET /bindings",
  "GET /worldstate/buckets",
  "GET /worldstate/split",
  "GET /worldstate/cache-plan",
  "POST /worldstate/push",
  "GET /worldstate/status",
  "GET /worldstate/stats",
  "GET /worldstate/stats/daily",
  "GET /worldstate/push-candidates",
  "GET /debug/queue/index",
  "GET /debug/r1/index",
  "GET /debug/r2/index",
  "GET /debug/kv/index",
  "GET /debug/d1/index"
];

// src/routes/core.ts
function registerCoreRoutes(app2) {
  app2.get("/", (c) => {
    return c.json({
      ok: true,
      message: "Active routes",
      routes: ACTIVE_ROUTES
    });
  });
  app2.get("/health", (c) => {
    return c.json({ status: "healthy" });
  });
  app2.get("/bindings", (c) => {
    return c.json({
      kvPrepared: !!c.env.TENNODEV_WORLDSTATE_KV,
      r2Prepared: !!c.env.TENNODEV_ASSETS_R2,
      d1Prepared: !!c.env.TENNODEV_WORLDSTATE_D1,
      queueActive: !!c.env.TENNODEV_PUSH_QUEUE,
      queueBinding: "TENNODEV_PUSH_QUEUE"
    });
  });
}
__name(registerCoreRoutes, "registerCoreRoutes");

// src/app/http.ts
function parseLimit(input, fallback = 50, max = 200) {
  const parsed = Number.parseInt(input ?? "", 10);
  if (Number.isNaN(parsed) || parsed < 1) {
    return fallback;
  }
  return Math.min(parsed, max);
}
__name(parseLimit, "parseLimit");
function parseBoolean(input) {
  if (!input) {
    return false;
  }
  return ["1", "true", "yes", "on"].includes(input.toLowerCase());
}
__name(parseBoolean, "parseBoolean");

// src/cache/keys.ts
var CACHE_NAMESPACE = "wf:worldstate";
function normalizeLocale(locale) {
  return locale.trim().toLowerCase() || "en";
}
__name(normalizeLocale, "normalizeLocale");
function buildBucketCacheKey(bucket, options) {
  const locale = normalizeLocale(options?.locale ?? "en");
  const parts = [CACHE_NAMESPACE, "bucket", bucket, "lang", locale];
  if (options?.version) {
    parts.push("v", options.version);
  }
  return parts.join(":");
}
__name(buildBucketCacheKey, "buildBucketCacheKey");
function buildMetaCacheKey() {
  return `${CACHE_NAMESPACE}:meta`;
}
__name(buildMetaCacheKey, "buildMetaCacheKey");
function buildRawSnapshotKey(runId) {
  return `${CACHE_NAMESPACE}:raw:run:${runId}`;
}
__name(buildRawSnapshotKey, "buildRawSnapshotKey");
function buildLatestRunKey() {
  return `${CACHE_NAMESPACE}:meta:latest-run`;
}
__name(buildLatestRunKey, "buildLatestRunKey");
function buildRunSummaryKey(runId) {
  return `${CACHE_NAMESPACE}:run:${runId}:summary`;
}
__name(buildRunSummaryKey, "buildRunSummaryKey");
function buildRootPayloadKey(rootKey, runId) {
  return `${CACHE_NAMESPACE}:root:${rootKey}:run:${runId}`;
}
__name(buildRootPayloadKey, "buildRootPayloadKey");
function buildCurrentRootPayloadKey(rootKey) {
  return `${CACHE_NAMESPACE}:root:${rootKey}:current`;
}
__name(buildCurrentRootPayloadKey, "buildCurrentRootPayloadKey");
function buildLastKnownRootPayloadKey(rootKey) {
  return `${CACHE_NAMESPACE}:root:${rootKey}:last-known`;
}
__name(buildLastKnownRootPayloadKey, "buildLastKnownRootPayloadKey");
function buildDummyTranslationKey(runId, rootKey) {
  return `${CACHE_NAMESPACE}:translate:dummy:run:${runId}:root:${rootKey}`;
}
__name(buildDummyTranslationKey, "buildDummyTranslationKey");

// src/cache/store.ts
var KV_TTL = {
  rawSnapshotSeconds: 60 * 60 * 24,
  rootPayloadSeconds: 60 * 60 * 24,
  currentRootPayloadSeconds: null,
  runSummarySeconds: 60 * 60 * 24 * 7,
  latestRunMetaSeconds: 60 * 60 * 24 * 30,
  rootHashIndexSeconds: 60 * 60 * 24 * 30
};
async function saveRawSnapshot(kv, runId, payload, ttlSeconds = KV_TTL.rawSnapshotSeconds) {
  const key = buildRawSnapshotKey(runId);
  await kv.put(key, payload, { expirationTtl: ttlSeconds });
  return key;
}
__name(saveRawSnapshot, "saveRawSnapshot");
async function loadRawSnapshotByKey(kv, key) {
  return kv.get(key);
}
__name(loadRawSnapshotByKey, "loadRawSnapshotByKey");
async function saveRootPayload(kv, rootKey, runId, payload, ttlSeconds = KV_TTL.rootPayloadSeconds) {
  const key = buildRootPayloadKey(rootKey, runId);
  await kv.put(key, payload, { expirationTtl: ttlSeconds });
  return key;
}
__name(saveRootPayload, "saveRootPayload");
async function loadCurrentRootPayload(kv, rootKey) {
  return kv.get(buildCurrentRootPayloadKey(rootKey), "json");
}
__name(loadCurrentRootPayload, "loadCurrentRootPayload");
async function saveCurrentRootPayload(kv, rootKey, payload) {
  const key = buildCurrentRootPayloadKey(rootKey);
  const ttlSeconds = KV_TTL.currentRootPayloadSeconds;
  if (ttlSeconds === null) {
    await kv.put(key, payload);
  } else {
    await kv.put(key, payload, { expirationTtl: ttlSeconds });
  }
  return key;
}
__name(saveCurrentRootPayload, "saveCurrentRootPayload");
async function saveLastKnownRootPayload(kv, rootKey, payload) {
  const key = buildLastKnownRootPayloadKey(rootKey);
  await kv.put(key, payload);
  return key;
}
__name(saveLastKnownRootPayload, "saveLastKnownRootPayload");
async function deleteCurrentRootPayload(kv, rootKey) {
  await kv.delete(buildCurrentRootPayloadKey(rootKey));
}
__name(deleteCurrentRootPayload, "deleteCurrentRootPayload");
async function saveRunSummary(kv, runId, summary, ttlSeconds = KV_TTL.runSummarySeconds) {
  const key = buildRunSummaryKey(runId);
  await kv.put(key, JSON.stringify(summary), { expirationTtl: ttlSeconds });
  return key;
}
__name(saveRunSummary, "saveRunSummary");
async function saveLatestRunMeta(kv, meta, ttlSeconds = KV_TTL.latestRunMetaSeconds) {
  await kv.put(buildLatestRunKey(), JSON.stringify(meta), {
    expirationTtl: ttlSeconds
  });
}
__name(saveLatestRunMeta, "saveLatestRunMeta");
async function loadLatestRunMeta(kv) {
  const raw2 = await kv.get(buildLatestRunKey(), "json");
  if (!raw2 || typeof raw2 !== "object" || Array.isArray(raw2)) {
    return null;
  }
  return raw2;
}
__name(loadLatestRunMeta, "loadLatestRunMeta");

// src/pipeline/classification.ts
var HIGH_SIGNAL_ROOT_KEYS = /* @__PURE__ */ new Set([
  "Alerts",
  "Events",
  "Invasions",
  "Sorties",
  "SyndicateMissions",
  "VoidTraders",
  "FlashSales",
  "DailyDeals",
  "WorldSeed"
]);
function classifyPushCandidateKeys(rootKeys) {
  const pushCandidateKeys = [];
  const nonPushKeys = [];
  for (const rootKey of rootKeys) {
    if (HIGH_SIGNAL_ROOT_KEYS.has(rootKey)) {
      pushCandidateKeys.push(rootKey);
    } else {
      nonPushKeys.push(rootKey);
    }
  }
  return { pushCandidateKeys, nonPushKeys };
}
__name(classifyPushCandidateKeys, "classifyPushCandidateKeys");
function classifyPushCandidates(changed) {
  return classifyPushCandidateKeys(changed.map((item) => item.rootKey));
}
__name(classifyPushCandidates, "classifyPushCandidates");

// src/tennodev/diff.ts
function stableStringify(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const entries = Object.entries(value).sort(
    (a, b) => a[0].localeCompare(b[0])
  );
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
}
__name(stableStringify, "stableStringify");
async function hashString(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const view = new Uint8Array(digest);
  return Array.from(view).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
__name(hashString, "hashString");
async function hashValue(value) {
  return hashString(stableStringify(value));
}
__name(hashValue, "hashValue");
function extractObjectIdentity(value) {
  const identityKeys = ["_id", "id", "Id", "Node", "node", "Tag", "tag", "name", "Name"];
  for (const key of identityKeys) {
    const candidate = value[key];
    if (typeof candidate === "string" || typeof candidate === "number") {
      return `${key}:${String(candidate)}`;
    }
  }
  return null;
}
__name(extractObjectIdentity, "extractObjectIdentity");
function normalizeRootItems(rootValue) {
  if (Array.isArray(rootValue)) {
    return rootValue.map((item, index) => {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const identity = extractObjectIdentity(item);
        if (identity) {
          return { itemId: identity, value: item };
        }
      }
      return {
        itemId: `index:${index}`,
        value: item
      };
    });
  }
  if (rootValue && typeof rootValue === "object") {
    return Object.entries(rootValue).sort((a, b) => a[0].localeCompare(b[0])).map(([key, value]) => ({ itemId: key, value }));
  }
  return [{ itemId: "value", value: rootValue }];
}
__name(normalizeRootItems, "normalizeRootItems");
async function diffRootItems(rootKey, previousValue, nextValue) {
  const previousItems = normalizeRootItems(previousValue);
  const nextItems = normalizeRootItems(nextValue);
  const previousMap = /* @__PURE__ */ new Map();
  const nextMap = /* @__PURE__ */ new Map();
  for (const item of previousItems) {
    previousMap.set(item.itemId, await hashValue(item.value));
  }
  for (const item of nextItems) {
    nextMap.set(item.itemId, await hashValue(item.value));
  }
  const itemIds = /* @__PURE__ */ new Set([...previousMap.keys(), ...nextMap.keys()]);
  const changes = [];
  for (const itemId of Array.from(itemIds).sort((a, b) => a.localeCompare(b))) {
    const previousHash = previousMap.get(itemId) ?? null;
    const nextHash = nextMap.get(itemId) ?? null;
    if (previousHash === null && nextHash !== null) {
      changes.push({ rootKey, itemId, changeType: "added", previousHash, nextHash });
      continue;
    }
    if (previousHash !== null && nextHash === null) {
      changes.push({ rootKey, itemId, changeType: "removed", previousHash, nextHash });
      continue;
    }
    if (previousHash !== nextHash) {
      changes.push({ rootKey, itemId, changeType: "updated", previousHash, nextHash });
    }
  }
  return changes;
}
__name(diffRootItems, "diffRootItems");
async function hashRootValues(worldState) {
  const hashes = {};
  const keys = Object.keys(worldState).sort((a, b) => a.localeCompare(b));
  for (const key of keys) {
    hashes[key] = await hashString(stableStringify(worldState[key]));
  }
  return hashes;
}
__name(hashRootValues, "hashRootValues");
function diffRootHashes(previousHashes, nextHashes, force = false) {
  const allKeys = /* @__PURE__ */ new Set([...Object.keys(previousHashes), ...Object.keys(nextHashes)]);
  const sortedKeys = Array.from(allKeys).sort((a, b) => a.localeCompare(b));
  return sortedKeys.map((rootKey) => {
    const previousHash = previousHashes[rootKey] ?? null;
    const nextHash = nextHashes[rootKey] ?? "";
    const changed = force || previousHash !== nextHash;
    return {
      rootKey,
      previousHash,
      nextHash,
      changed
    };
  });
}
__name(diffRootHashes, "diffRootHashes");

// src/tennodev/languages.ts
var TRANSLATE_TARGET_LANGUAGES = [
  "de",
  "es",
  "fr",
  "it",
  "ko",
  "pl",
  "pt",
  "ru",
  "zh",
  "en",
  "uk"
];

// src/tennodev/client.ts
var DEFAULT_WORLDSTATE_URL = "https://api.warframe.com/cdn/worldState.php";
async function fetchWorldState(input = DEFAULT_WORLDSTATE_URL, init) {
  const response = await fetch(input, init);
  if (!response.ok) {
    throw new Error(`Failed to fetch worldState: ${response.status} ${response.statusText}`);
  }
  const data = await response.json();
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Invalid worldState payload: expected a JSON object");
  }
  return data;
}
__name(fetchWorldState, "fetchWorldState");

// src/types/worldstate.ts
var TOP_LEVEL_WORLDSTATE_KEYS = [
  "WorldSeed",
  "Version",
  "MobileVersion",
  "BuildLabel",
  "Time",
  "Events",
  "Goals",
  "Alerts",
  "Sorties",
  "LiteSorties",
  "SyndicateMissions",
  "ActiveMissions",
  "GlobalUpgrades",
  "FlashSales",
  "SkuSales",
  "InGameMarket",
  "Invasions",
  "HubEvents",
  "NodeOverrides",
  "VoidTraders",
  "PrimeVaultTraders",
  "VoidStorms",
  "PrimeAccessAvailability",
  "PrimeVaultAvailabilities",
  "PrimeTokenAvailability",
  "DailyDeals",
  "LibraryInfo",
  "PVPChallengeInstances",
  "PersistentEnemies",
  "PVPAlternativeModes",
  "PVPActiveTournaments",
  "ProjectPct",
  "ConstructionProjects",
  "TwitchPromos",
  "ExperimentRecommended",
  "EndlessXpChoices",
  "EndlessXpSchedule",
  "ForceLogoutVersion",
  "FeaturedGuilds",
  "SeasonInfo",
  "KnownCalendarSeasons",
  "Conquests",
  "Descents",
  "Tmp"
];

// src/tennodev/sections.ts
var WORLDSTATE_BUCKETS = {
  coreMeta: ["WorldSeed", "Version", "MobileVersion", "BuildLabel", "Time"],
  eventsAnnouncements: [
    "Events",
    "Alerts",
    "Goals",
    "HubEvents",
    "GlobalUpgrades",
    "TwitchPromos"
  ],
  rotationsMissions: [
    "Sorties",
    "LiteSorties",
    "SyndicateMissions",
    "ActiveMissions",
    "VoidStorms",
    "VoidTraders",
    "PrimeVaultTraders"
  ],
  economyMarket: ["FlashSales", "SkuSales", "InGameMarket", "DailyDeals"],
  conflictWorld: ["Invasions", "NodeOverrides", "ConstructionProjects", "ProjectPct"],
  primeSeason: [
    "PrimeAccessAvailability",
    "PrimeVaultAvailabilities",
    "PrimeTokenAvailability",
    "SeasonInfo",
    "KnownCalendarSeasons"
  ],
  pvpChallenges: [
    "PVPChallengeInstances",
    "PVPAlternativeModes",
    "PVPActiveTournaments",
    "Conquests",
    "Descents"
  ],
  miscSystem: [
    "LibraryInfo",
    "PersistentEnemies",
    "ExperimentRecommended",
    "EndlessXpChoices",
    "EndlessXpSchedule",
    "ForceLogoutVersion",
    "FeaturedGuilds",
    "Tmp"
  ]
};
function pickKeys(source, keys) {
  const selected = {};
  for (const key of keys) {
    if (key in source) {
      selected[key] = source[key];
    }
  }
  return selected;
}
__name(pickKeys, "pickKeys");
function splitWorldStateByBuckets(worldState) {
  const bucketNames = Object.keys(WORLDSTATE_BUCKETS);
  const buckets = {};
  for (const bucketName of bucketNames) {
    buckets[bucketName] = pickKeys(worldState, WORLDSTATE_BUCKETS[bucketName]);
  }
  const known = new Set(TOP_LEVEL_WORLDSTATE_KEYS);
  const unknownKeys = Object.keys(worldState).filter((key) => !known.has(key));
  return { buckets, unknownKeys };
}
__name(splitWorldStateByBuckets, "splitWorldStateByBuckets");

// src/db/sql.ts
var SQL = {
  createPipelineRunsTable: "CREATE TABLE IF NOT EXISTS pipeline_runs (run_id TEXT PRIMARY KEY, fetched_at TEXT NOT NULL, source_version TEXT, changed_count INTEGER NOT NULL, dry_run INTEGER NOT NULL, queued_count INTEGER NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP)",
  createPipelineDiffsTable: "CREATE TABLE IF NOT EXISTS pipeline_diffs (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, root_key TEXT NOT NULL, previous_hash TEXT, next_hash TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP)",
  createPipelineItemChangesTable: "CREATE TABLE IF NOT EXISTS pipeline_item_changes (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, root_key TEXT NOT NULL, item_id TEXT NOT NULL, change_type TEXT NOT NULL, previous_hash TEXT, next_hash TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)",
  createTranslateQueueLogsTable: "CREATE TABLE IF NOT EXISTS translate_queue_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, root_key TEXT NOT NULL, payload_key TEXT NOT NULL, target_languages TEXT NOT NULL, payload_size INTEGER NOT NULL, status TEXT NOT NULL, error TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)",
  selectOldRunsBeyondRetention: "SELECT run_id as runId FROM pipeline_runs ORDER BY fetched_at DESC, run_id DESC LIMIT -1 OFFSET ?",
  selectDiffRootKeysByRun: "SELECT root_key as rootKey FROM pipeline_diffs WHERE run_id = ?",
  selectQueueRootKeysByRun: "SELECT root_key as rootKey FROM translate_queue_logs WHERE run_id = ?",
  deleteQueueLogsByRun: "DELETE FROM translate_queue_logs WHERE run_id = ?",
  deletePipelineDiffsByRun: "DELETE FROM pipeline_diffs WHERE run_id = ?",
  deletePipelineItemChangesByRun: "DELETE FROM pipeline_item_changes WHERE run_id = ?",
  deletePipelineRunByRun: "DELETE FROM pipeline_runs WHERE run_id = ?",
  insertPipelineDiff: "INSERT INTO pipeline_diffs (run_id, root_key, previous_hash, next_hash) VALUES (?, ?, ?, ?)",
  insertPipelineItemChange: "INSERT INTO pipeline_item_changes (run_id, root_key, item_id, change_type, previous_hash, next_hash) VALUES (?, ?, ?, ?, ?, ?)",
  upsertPipelineRun: "INSERT OR REPLACE INTO pipeline_runs (run_id, fetched_at, source_version, changed_count, dry_run, queued_count) VALUES (?, ?, ?, ?, ?, ?)",
  countPipelineRuns: "SELECT COUNT(*) as count FROM pipeline_runs",
  selectItemChangeStatsByDays: "SELECT root_key as rootKey, COUNT(*) as changedItems, SUM(CASE WHEN change_type = 'added' THEN 1 ELSE 0 END) as added, SUM(CASE WHEN change_type = 'removed' THEN 1 ELSE 0 END) as removed, SUM(CASE WHEN change_type = 'updated' THEN 1 ELSE 0 END) as updated FROM pipeline_item_changes WHERE created_at >= datetime('now', ?) GROUP BY root_key ORDER BY changedItems DESC, rootKey ASC",
  selectItemChangeDailyStatsByDays: "SELECT date(created_at) as day, root_key as rootKey, COUNT(*) as changedItems, SUM(CASE WHEN change_type = 'added' THEN 1 ELSE 0 END) as added, SUM(CASE WHEN change_type = 'removed' THEN 1 ELSE 0 END) as removed, SUM(CASE WHEN change_type = 'updated' THEN 1 ELSE 0 END) as updated FROM pipeline_item_changes WHERE created_at >= datetime('now', ?) GROUP BY date(created_at), root_key ORDER BY day ASC, rootKey ASC",
  insertTranslateQueueLog: "INSERT INTO translate_queue_logs (run_id, root_key, payload_key, target_languages, payload_size, status, error) VALUES (?, ?, ?, ?, ?, ?, ?)",
  selectQueueLogs: "SELECT id, run_id as runId, root_key as rootKey, payload_key as payloadKey, target_languages as targetLanguages, payload_size as payloadSize, status, error, created_at as createdAt FROM translate_queue_logs ORDER BY id DESC LIMIT ?",
  selectSchemaObjects: "SELECT name, type, tbl_name as tableName, sql FROM sqlite_master WHERE type IN ('table', 'index') ORDER BY type, name LIMIT ?"
};

// src/pipeline/retention.ts
var MAX_RETAINED_RUNS = 60;
async function ensureDiffTables(db) {
  await db.prepare(SQL.createPipelineRunsTable).run();
  await db.prepare(SQL.createPipelineDiffsTable).run();
  await db.prepare(SQL.createPipelineItemChangesTable).run();
}
__name(ensureDiffTables, "ensureDiffTables");
async function ensureQueueTables(db) {
  await db.prepare(SQL.createTranslateQueueLogsTable).run();
}
__name(ensureQueueTables, "ensureQueueTables");
async function pruneOldRuns(env) {
  await ensureDiffTables(env.TENNODEV_WORLDSTATE_D1);
  await ensureQueueTables(env.TENNODEV_WORLDSTATE_D1);
  const oldRuns = await env.TENNODEV_WORLDSTATE_D1.prepare(SQL.selectOldRunsBeyondRetention).bind(MAX_RETAINED_RUNS).all();
  for (const row of oldRuns.results) {
    const runId = row.runId;
    const diffRows = await env.TENNODEV_WORLDSTATE_D1.prepare(SQL.selectDiffRootKeysByRun).bind(runId).all();
    const queueRows = await env.TENNODEV_WORLDSTATE_D1.prepare(SQL.selectQueueRootKeysByRun).bind(runId).all();
    const diffRootKeys = new Set(diffRows.results.map((item) => item.rootKey));
    const queueRootKeys = new Set(queueRows.results.map((item) => item.rootKey));
    await env.TENNODEV_WORLDSTATE_KV.delete(buildRawSnapshotKey(runId));
    await env.TENNODEV_WORLDSTATE_KV.delete(buildRunSummaryKey(runId));
    for (const rootKey of diffRootKeys) {
      await env.TENNODEV_WORLDSTATE_KV.delete(buildRootPayloadKey(rootKey, runId));
    }
    for (const rootKey of queueRootKeys) {
      await env.TENNODEV_WORLDSTATE_KV.delete(buildDummyTranslationKey(runId, rootKey));
    }
    await env.TENNODEV_WORLDSTATE_D1.prepare(SQL.deleteQueueLogsByRun).bind(runId).run();
    await env.TENNODEV_WORLDSTATE_D1.prepare(SQL.deletePipelineDiffsByRun).bind(runId).run();
    await env.TENNODEV_WORLDSTATE_D1.prepare(SQL.deletePipelineItemChangesByRun).bind(runId).run();
    await env.TENNODEV_WORLDSTATE_D1.prepare(SQL.deletePipelineRunByRun).bind(runId).run();
  }
}
__name(pruneOldRuns, "pruneOldRuns");

// src/pipeline/persistence.ts
async function persistWorldStateRun(env, input) {
  const rawSnapshotKey = await saveRawSnapshot(env.TENNODEV_WORLDSTATE_KV, input.runId, input.rawPayload);
  const changedPayloadKeys = [];
  for (const item of input.changedPayloadValues) {
    const kvKey = await saveRootPayload(
      env.TENNODEV_WORLDSTATE_KV,
      item.rootKey,
      input.runId,
      item.payload
    );
    changedPayloadKeys.push({ rootKey: item.rootKey, kvKey });
  }
  await saveLatestRunMeta(env.TENNODEV_WORLDSTATE_KV, {
    runId: input.runId,
    fetchedAt: input.fetchedAt,
    sourceVersion: input.sourceVersion,
    changedRootKeys: input.changed.map((item) => item.rootKey)
  });
  for (const item of input.changed) {
    await env.TENNODEV_WORLDSTATE_D1.prepare(SQL.insertPipelineDiff).bind(input.runId, item.rootKey, item.previousHash, item.nextHash).run();
  }
  for (const item of input.itemChanges) {
    await env.TENNODEV_WORLDSTATE_D1.prepare(SQL.insertPipelineItemChange).bind(input.runId, item.rootKey, item.itemId, item.changeType, item.previousHash, item.nextHash).run();
  }
  return { rawSnapshotKey, changedPayloadKeys };
}
__name(persistWorldStateRun, "persistWorldStateRun");
async function recordPreparedWorldStateRun(env, input) {
  await saveLatestRunMeta(env.TENNODEV_WORLDSTATE_KV, {
    runId: input.runId,
    fetchedAt: input.fetchedAt,
    sourceVersion: input.sourceVersion,
    changedRootKeys: input.changedRootKeys
  });
  await saveRunSummary(env.TENNODEV_WORLDSTATE_KV, input.runId, {
    runId: input.runId,
    fetchedAt: input.fetchedAt,
    sourceVersion: input.sourceVersion,
    rawSnapshotKey: input.rawSnapshotKey,
    changedRootKeys: input.changedRootKeys,
    changedCount: input.changedCount,
    queuedCount: input.queuedCount,
    dryRun: false,
    force: input.force,
    sourceLocale: input.sourceLocale,
    targetLanguages: input.targetLanguages,
    pushCandidateKeys: input.pushCandidateKeys,
    nonPushKeys: input.nonPushKeys,
    mode: "async-fanout",
    stage: "prepared"
  });
  await ensureDiffTables(env.TENNODEV_WORLDSTATE_D1);
  await env.TENNODEV_WORLDSTATE_D1.prepare(SQL.upsertPipelineRun).bind(input.runId, input.fetchedAt, input.sourceVersion, input.changedCount, 0, input.queuedCount).run();
}
__name(recordPreparedWorldStateRun, "recordPreparedWorldStateRun");
async function writeRootChange(env, input) {
  const kvKey = await saveRootPayload(
    env.TENNODEV_WORLDSTATE_KV,
    input.rootKey,
    input.runId,
    input.payload
  );
  await env.TENNODEV_WORLDSTATE_D1.prepare(SQL.insertPipelineDiff).bind(input.runId, input.rootKey, input.previousHash, input.nextHash).run();
  for (const item of input.itemChanges) {
    await env.TENNODEV_WORLDSTATE_D1.prepare(SQL.insertPipelineItemChange).bind(input.runId, item.rootKey, item.itemId, item.changeType, item.previousHash, item.nextHash).run();
  }
  return kvKey;
}
__name(writeRootChange, "writeRootChange");
async function loadPreviousRootValues(kv, rootKeys) {
  const result = {};
  for (const rootKey of rootKeys) {
    result[rootKey] = await loadCurrentRootPayload(kv, rootKey);
  }
  return result;
}
__name(loadPreviousRootValues, "loadPreviousRootValues");
async function finalizeWorldStateRun(env, input) {
  const summary = {
    runId: input.runId,
    fetchedAt: input.fetchedAt,
    sourceVersion: input.sourceVersion,
    changedRootKeys: input.changedRootKeys,
    changedCount: input.changedCount,
    queuedCount: input.queuedCount,
    dryRun: input.dryRun,
    force: input.force,
    sourceLocale: input.sourceLocale,
    targetLanguages: input.targetLanguages
  };
  await saveRunSummary(env.TENNODEV_WORLDSTATE_KV, input.runId, summary);
  await ensureDiffTables(env.TENNODEV_WORLDSTATE_D1);
  await env.TENNODEV_WORLDSTATE_D1.prepare(SQL.upsertPipelineRun).bind(
    input.runId,
    input.fetchedAt,
    input.sourceVersion,
    input.changedCount,
    input.dryRun ? 1 : 0,
    input.queuedCount
  ).run();
  await pruneOldRuns(env);
}
__name(finalizeWorldStateRun, "finalizeWorldStateRun");
async function getPipelineRunCount(db) {
  await ensureDiffTables(db);
  const runCountQuery = await db.prepare(SQL.countPipelineRuns).all();
  return Number(runCountQuery.results[0]?.count ?? 0);
}
__name(getPipelineRunCount, "getPipelineRunCount");
async function getItemChangeStats(db, days) {
  await ensureDiffTables(db);
  const window = `-${days} days`;
  const result = await db.prepare(SQL.selectItemChangeStatsByDays).bind(window).all();
  return result.results.map((row) => ({
    rootKey: row.rootKey,
    changedItems: Number(row.changedItems ?? 0),
    added: Number(row.added ?? 0),
    removed: Number(row.removed ?? 0),
    updated: Number(row.updated ?? 0)
  }));
}
__name(getItemChangeStats, "getItemChangeStats");
async function getItemChangeDailyStats(db, days, rootKey) {
  await ensureDiffTables(db);
  const window = `-${days} days`;
  const result = await db.prepare(SQL.selectItemChangeDailyStatsByDays).bind(window).all();
  return result.results.filter((row) => !rootKey || row.rootKey === rootKey).map((row) => ({
    day: row.day,
    rootKey: row.rootKey,
    changedItems: Number(row.changedItems ?? 0),
    added: Number(row.added ?? 0),
    removed: Number(row.removed ?? 0),
    updated: Number(row.updated ?? 0)
  }));
}
__name(getItemChangeDailyStats, "getItemChangeDailyStats");
async function writeDummyTranslationArtifact(env, input) {
  const dummyKey = buildDummyTranslationKey(input.runId, input.rootKey);
  const dummyResult = {
    runId: input.runId,
    rootKey: input.rootKey,
    sourceLocale: input.sourceLocale,
    targetLanguages: input.targetLanguages,
    payloadKey: input.payloadKey,
    payloadSize: input.payloadSize,
    translatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    mode: "dummy"
  };
  await env.TENNODEV_WORLDSTATE_KV.put(dummyKey, JSON.stringify(dummyResult), {
    expirationTtl: 60 * 60 * 24 * 7
  });
}
__name(writeDummyTranslationArtifact, "writeDummyTranslationArtifact");
async function logQueueProcessed(db, input) {
  await ensureQueueTables(db);
  await db.prepare(SQL.insertTranslateQueueLog).bind(
    input.runId,
    input.rootKey,
    input.payloadKey,
    JSON.stringify(input.targetLanguages),
    input.payloadSize,
    "processed",
    null
  ).run();
}
__name(logQueueProcessed, "logQueueProcessed");
async function logQueueFailed(db, input) {
  await ensureQueueTables(db);
  await db.prepare(SQL.insertTranslateQueueLog).bind(
    input.runId,
    input.rootKey,
    input.payloadKey,
    JSON.stringify(input.targetLanguages),
    0,
    "failed",
    input.error
  ).run();
}
__name(logQueueFailed, "logQueueFailed");

// src/cache/policy.ts
var BUCKET_TTL_SECONDS = {
  coreMeta: 1800,
  eventsAnnouncements: 180,
  rotationsMissions: 600,
  economyMarket: 180,
  conflictWorld: 120,
  primeSeason: 3600,
  pvpChallenges: 900,
  miscSystem: 1800
};
function getBucketTtlSeconds(bucket) {
  return BUCKET_TTL_SECONDS[bucket];
}
__name(getBucketTtlSeconds, "getBucketTtlSeconds");
function getExpiryIso(ttlSeconds, now = /* @__PURE__ */ new Date()) {
  const expiryMs = now.getTime() + ttlSeconds * 1e3;
  return new Date(expiryMs).toISOString();
}
__name(getExpiryIso, "getExpiryIso");

// src/pipeline/read-models.ts
async function buildWorldStateSplitModel() {
  const worldState = await fetchWorldState();
  const split = splitWorldStateByBuckets(worldState);
  return {
    fetchedAt: (/* @__PURE__ */ new Date()).toISOString(),
    unknownKeys: split.unknownKeys,
    buckets: split.buckets
  };
}
__name(buildWorldStateSplitModel, "buildWorldStateSplitModel");
async function buildWorldStateCachePlanModel(locale = "en") {
  const worldState = await fetchWorldState();
  const split = splitWorldStateByBuckets(worldState);
  const versionValue = worldState.Version;
  const version = typeof versionValue === "number" || typeof versionValue === "string" ? String(versionValue) : void 0;
  const bucketNames = Object.keys(split.buckets);
  const plan = bucketNames.map((bucket) => {
    const ttlSeconds = getBucketTtlSeconds(bucket);
    return {
      bucket,
      key: buildBucketCacheKey(bucket, { locale, version }),
      ttlSeconds,
      expiresAt: getExpiryIso(ttlSeconds),
      hasData: Object.keys(split.buckets[bucket]).length > 0
    };
  });
  return {
    fetchedAt: (/* @__PURE__ */ new Date()).toISOString(),
    locale,
    metaKey: buildMetaCacheKey(),
    plan
  };
}
__name(buildWorldStateCachePlanModel, "buildWorldStateCachePlanModel");
function buildWorldStateStatusModel(input) {
  return {
    ok: true,
    latestRun: input.latestRun,
    rootHashCount: input.rootHashCount,
    d1RunCount: input.d1RunCount,
    retainedRunLimit: MAX_RETAINED_RUNS,
    queueLanguages: TRANSLATE_TARGET_LANGUAGES
  };
}
__name(buildWorldStateStatusModel, "buildWorldStateStatusModel");

// src/pipeline/messages.ts
function buildPrepareWorldStateRunMessage(input) {
  return {
    type: "worldstate.prepare-run",
    runId: input.runId,
    fetchedAt: input.fetchedAt,
    sourceVersion: input.sourceVersion,
    sourceLocale: input.sourceLocale,
    targetLanguages: input.targetLanguages,
    rawSnapshotKey: input.rawSnapshotKey,
    force: input.force
  };
}
__name(buildPrepareWorldStateRunMessage, "buildPrepareWorldStateRunMessage");
function buildProcessWorldStateRootMessages(input, payloads) {
  return payloads.map((payload) => ({
    type: "worldstate.process-root",
    runId: input.runId,
    fetchedAt: input.fetchedAt,
    sourceVersion: input.sourceVersion,
    sourceLocale: input.sourceLocale,
    targetLanguages: input.targetLanguages,
    rawSnapshotKey: input.rawSnapshotKey,
    rootKey: payload.rootKey,
    previousHash: payload.previousHash,
    nextHash: payload.nextHash
  }));
}
__name(buildProcessWorldStateRootMessages, "buildProcessWorldStateRootMessages");
function buildTranslateQueueMessages(input, payloads) {
  return payloads.map((payload) => ({
    type: "worldstate.translate-root",
    runId: input.runId,
    fetchedAt: input.fetchedAt,
    sourceVersion: input.sourceVersion,
    sourceLocale: input.sourceLocale,
    targetLanguages: input.targetLanguages,
    rootKey: payload.rootKey,
    payloadKey: payload.payloadKey
  }));
}
__name(buildTranslateQueueMessages, "buildTranslateQueueMessages");

// src/pipeline/worldstate.ts
async function getWorldStateSplit() {
  return buildWorldStateSplitModel();
}
__name(getWorldStateSplit, "getWorldStateSplit");
async function getWorldStateCachePlan(locale = "en") {
  return buildWorldStateCachePlanModel(locale);
}
__name(getWorldStateCachePlan, "getWorldStateCachePlan");
async function executeWorldStatePush(c, options) {
  const sourceLocale = "en";
  const fetchedAt = (/* @__PURE__ */ new Date()).toISOString();
  const runId = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const worldState = await fetchWorldState();
  const rawPayload = JSON.stringify(worldState);
  const sourceVersionRaw = worldState.Version;
  const sourceVersion = typeof sourceVersionRaw === "number" || typeof sourceVersionRaw === "string" ? String(sourceVersionRaw) : null;
  if (!options.dryRun) {
    const rawSnapshotKey2 = await saveRawSnapshot(c.env.TENNODEV_WORLDSTATE_KV, runId, rawPayload);
    const prepareMessage = buildPrepareWorldStateRunMessage({
      runId,
      fetchedAt,
      sourceVersion,
      sourceLocale,
      targetLanguages: TRANSLATE_TARGET_LANGUAGES,
      rawSnapshotKey: rawSnapshotKey2,
      force: options.force
    });
    await c.env.TENNODEV_PUSH_QUEUE.send(prepareMessage);
    return {
      ok: true,
      accepted: true,
      mode: "async-fanout",
      stage: "queued",
      runId,
      fetchedAt,
      sourceVersion,
      dryRun: false,
      force: options.force,
      changedCount: null,
      changedItemCount: null,
      changedRootKeys: null,
      pushCandidateKeys: null,
      nonPushKeys: null,
      queuedCount: 1,
      sourceLocale,
      targetLanguages: TRANSLATE_TARGET_LANGUAGES,
      queueActive: true,
      rawSnapshotKey: rawSnapshotKey2,
      changedPayloadKeys: [],
      queuePreview: [prepareMessage]
    };
  }
  const analysis = await analyzeWorldStateDiffs(c.env.TENNODEV_WORLDSTATE_KV, worldState, options.force);
  const changed = analysis.changed;
  const classification = analysis.classification;
  const previousRootValues = await loadPreviousRootValues(
    c.env.TENNODEV_WORLDSTATE_KV,
    changed.map((item) => item.rootKey)
  );
  const changedPayloadValues = changed.map((item) => ({
    rootKey: item.rootKey,
    payload: JSON.stringify(worldState[item.rootKey])
  }));
  const itemChanges = (await Promise.all(
    changed.map(
      (item) => diffRootItems(item.rootKey, previousRootValues[item.rootKey], worldState[item.rootKey])
    )
  )).flat();
  const dryRunPayloadKeys = changed.map((item) => ({
    rootKey: item.rootKey,
    payloadKey: buildRootPayloadKey(item.rootKey, runId)
  }));
  let rawSnapshotKey = null;
  let changedPayloadKeys = [];
  let queueMessages = buildTranslateQueueMessages(
    {
      runId,
      fetchedAt,
      sourceVersion,
      sourceLocale,
      targetLanguages: TRANSLATE_TARGET_LANGUAGES
    },
    dryRunPayloadKeys
  );
  let queuedCount = 0;
  if (!options.dryRun) {
    const persisted = await persistWorldStateRun(c.env, {
      runId,
      fetchedAt,
      sourceVersion,
      rawPayload,
      nextHashes: analysis.nextHashes,
      changed,
      changedPayloadValues,
      itemChanges
    });
    rawSnapshotKey = persisted.rawSnapshotKey;
    changedPayloadKeys = persisted.changedPayloadKeys;
    queueMessages = buildTranslateQueueMessages(
      {
        runId,
        fetchedAt,
        sourceVersion,
        sourceLocale,
        targetLanguages: TRANSLATE_TARGET_LANGUAGES
      },
      changedPayloadKeys.map((item) => ({ rootKey: item.rootKey, payloadKey: item.kvKey }))
    );
    for (const message of queueMessages) {
      await c.env.TENNODEV_PUSH_QUEUE.send(message);
      queuedCount += 1;
    }
    await finalizeWorldStateRun(c.env, {
      runId,
      fetchedAt,
      sourceVersion,
      changedRootKeys: changed.map((item) => item.rootKey),
      changedCount: changed.length,
      queuedCount,
      dryRun: options.dryRun,
      force: options.force,
      sourceLocale,
      targetLanguages: TRANSLATE_TARGET_LANGUAGES
    });
  } else {
    changedPayloadKeys = dryRunPayloadKeys.map((item) => ({ rootKey: item.rootKey, kvKey: item.payloadKey }));
  }
  return {
    ok: true,
    runId,
    fetchedAt,
    sourceVersion,
    dryRun: options.dryRun,
    force: options.force,
    changedCount: changed.length,
    changedItemCount: itemChanges.length,
    changedRootKeys: changed.map((item) => item.rootKey),
    pushCandidateKeys: classification.pushCandidateKeys,
    nonPushKeys: classification.nonPushKeys,
    queuedCount,
    sourceLocale,
    targetLanguages: TRANSLATE_TARGET_LANGUAGES,
    queueActive: true,
    rawSnapshotKey,
    changedPayloadKeys,
    queuePreview: queueMessages
  };
}
__name(executeWorldStatePush, "executeWorldStatePush");
async function getWorldStateStatus(c) {
  const latestRun = await loadLatestRunMeta(c.env.TENNODEV_WORLDSTATE_KV);
  const rootHashes = await loadCurrentRootHashes(c.env.TENNODEV_WORLDSTATE_KV);
  const totalRuns = await getPipelineRunCount(c.env.TENNODEV_WORLDSTATE_D1);
  return buildWorldStateStatusModel({
    latestRun,
    rootHashCount: Object.keys(rootHashes).length,
    d1RunCount: totalRuns
  });
}
__name(getWorldStateStatus, "getWorldStateStatus");
async function loadCurrentRootHashes(kv) {
  const currentEntries = await Promise.all(
    TOP_LEVEL_WORLDSTATE_KEYS.map(async (rootKey) => ({
      rootKey,
      value: await loadCurrentRootPayload(kv, rootKey)
    }))
  );
  const hashes = {};
  await Promise.all(
    currentEntries.map(async (entry) => {
      if (entry.value !== null) {
        hashes[entry.rootKey] = await hashString(stableStringify(entry.value));
      }
    })
  );
  return hashes;
}
__name(loadCurrentRootHashes, "loadCurrentRootHashes");
async function analyzeWorldStateDiffs(kv, worldState, force) {
  const nextHashes = await hashRootValues(worldState);
  const previousHashes = await loadCurrentRootHashes(kv);
  const diffs = diffRootHashes(previousHashes, nextHashes, force);
  const changed = diffs.filter((item) => item.changed);
  return {
    nextHashes,
    changed,
    classification: classifyPushCandidates(changed)
  };
}
__name(analyzeWorldStateDiffs, "analyzeWorldStateDiffs");
async function getLatestPushCandidates(c) {
  const latestRun = await loadLatestRunMeta(c.env.TENNODEV_WORLDSTATE_KV);
  const changedRootKeys = latestRun?.changedRootKeys ?? [];
  const classification = classifyPushCandidateKeys(changedRootKeys);
  return {
    ok: true,
    latestRun,
    changedRootKeys,
    pushCandidateKeys: classification.pushCandidateKeys,
    nonPushKeys: classification.nonPushKeys
  };
}
__name(getLatestPushCandidates, "getLatestPushCandidates");
async function getWorldStateStats(c, days) {
  const safeDays = Math.max(1, Math.min(days, 365));
  const rootKeyStats = await getItemChangeStats(c.env.TENNODEV_WORLDSTATE_D1, safeDays);
  return {
    ok: true,
    days: safeDays,
    rootKeyStats
  };
}
__name(getWorldStateStats, "getWorldStateStats");
async function getWorldStateDailyStats(c, days, rootKey) {
  const safeDays = Math.max(1, Math.min(days, 365));
  const dailyRootKeyStats = await getItemChangeDailyStats(
    c.env.TENNODEV_WORLDSTATE_D1,
    safeDays,
    rootKey
  );
  return {
    ok: true,
    days: safeDays,
    rootKey: rootKey ?? null,
    dailyRootKeyStats
  };
}
__name(getWorldStateDailyStats, "getWorldStateDailyStats");

// src/routes/worldstate.ts
function registerWorldStateRoutes(app2) {
  app2.get("/worldstate/buckets", (c) => {
    return c.json({
      buckets: WORLDSTATE_BUCKETS
    });
  });
  app2.get("/worldstate/split", async (c) => {
    return c.json(await getWorldStateSplit());
  });
  app2.get("/worldstate/cache-plan", async (c) => {
    const locale = c.req.query("lang") ?? "en";
    return c.json(await getWorldStateCachePlan(locale));
  });
  app2.post("/worldstate/push", async (c) => {
    const dryRun = parseBoolean(c.req.query("dryRun"));
    const force = parseBoolean(c.req.query("force"));
    return c.json(await executeWorldStatePush(c, { dryRun, force }));
  });
  app2.get("/worldstate/status", async (c) => {
    return c.json(await getWorldStateStatus(c));
  });
  app2.get("/worldstate/stats", async (c) => {
    const days = Number.parseInt(c.req.query("days") ?? "30", 10);
    return c.json(await getWorldStateStats(c, Number.isNaN(days) ? 30 : days));
  });
  app2.get("/worldstate/stats/daily", async (c) => {
    const days = Number.parseInt(c.req.query("days") ?? "30", 10);
    const rootKey = c.req.query("rootKey") ?? void 0;
    return c.json(
      await getWorldStateDailyStats(c, Number.isNaN(days) ? 30 : days, rootKey)
    );
  });
  app2.get("/worldstate/push-candidates", async (c) => {
    return c.json(await getLatestPushCandidates(c));
  });
}
__name(registerWorldStateRoutes, "registerWorldStateRoutes");

// src/routes/debug.ts
async function debugR2Index(c) {
  const prefix = c.req.query("prefix") ?? "";
  const cursor = c.req.query("cursor") || void 0;
  const limit = parseLimit(c.req.query("limit"), 50, 500);
  const list = await c.env.TENNODEV_ASSETS_R2.list({ prefix, cursor, limit });
  return c.json({
    store: "r2",
    note: "r1 alias points to r2 in this project",
    prefix,
    limit,
    nextCursor: "cursor" in list ? list.cursor : null,
    truncated: list.truncated,
    objectCount: list.objects.length,
    objects: list.objects.map((obj) => ({
      key: obj.key,
      size: obj.size,
      etag: obj.etag,
      uploaded: obj.uploaded,
      version: obj.version,
      checksums: obj.checksums,
      httpEtag: obj.httpEtag
    }))
  });
}
__name(debugR2Index, "debugR2Index");
function registerDebugRoutes(app2) {
  app2.get("/debug/queue/index", async (c) => {
    const limit = parseLimit(c.req.query("limit"), 50, 500);
    await ensureQueueTables(c.env.TENNODEV_WORLDSTATE_D1);
    const result = await c.env.TENNODEV_WORLDSTATE_D1.prepare(SQL.selectQueueLogs).bind(limit).all();
    return c.json({
      store: "queue",
      limit,
      count: result.results.length,
      items: result.results
    });
  });
  app2.get("/debug/r2/index", debugR2Index);
  app2.get("/debug/r1/index", debugR2Index);
  app2.get("/debug/kv/index", async (c) => {
    const prefix = c.req.query("prefix") ?? "";
    const cursor = c.req.query("cursor") || void 0;
    const limit = parseLimit(c.req.query("limit"), 50, 1e3);
    const list = await c.env.TENNODEV_WORLDSTATE_KV.list({ prefix, cursor, limit });
    return c.json({
      store: "kv",
      prefix,
      limit,
      nextCursor: "cursor" in list ? list.cursor : null,
      listComplete: list.list_complete,
      keyCount: list.keys.length,
      keys: list.keys
    });
  });
  app2.get("/debug/d1/index", async (c) => {
    const limit = parseLimit(c.req.query("limit"), 100, 1e3);
    const result = await c.env.TENNODEV_WORLDSTATE_D1.prepare(SQL.selectSchemaObjects).bind(limit).all();
    return c.json({
      store: "d1",
      limit,
      count: result.results.length,
      indexes: result.results
    });
  });
}
__name(registerDebugRoutes, "registerDebugRoutes");

// src/queue/dummy-translator.ts
async function processDummyTranslationMessage(env, message) {
  const payload = await env.TENNODEV_WORLDSTATE_KV.get(message.payloadKey);
  const payloadSize = payload?.length ?? 0;
  await writeDummyTranslationArtifact(env, {
    runId: message.runId,
    rootKey: message.rootKey,
    sourceLocale: message.sourceLocale,
    targetLanguages: message.targetLanguages,
    payloadKey: message.payloadKey,
    payloadSize
  });
  await logQueueProcessed(env.TENNODEV_WORLDSTATE_D1, {
    runId: message.runId,
    rootKey: message.rootKey,
    payloadKey: message.payloadKey,
    targetLanguages: message.targetLanguages,
    payloadSize
  });
}
__name(processDummyTranslationMessage, "processDummyTranslationMessage");

// src/queue/pipeline.ts
function parseStoredWorldState(rawPayload) {
  const data = JSON.parse(rawPayload);
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Invalid stored worldState payload: expected a JSON object");
  }
  return data;
}
__name(parseStoredWorldState, "parseStoredWorldState");
async function handlePrepareWorldStateRun(env, message) {
  const rawPayload = await loadRawSnapshotByKey(env.TENNODEV_WORLDSTATE_KV, message.rawSnapshotKey);
  if (!rawPayload) {
    throw new Error(`Missing raw snapshot for run ${message.runId}`);
  }
  const worldState = parseStoredWorldState(rawPayload);
  const analysis = await analyzeWorldStateDiffs(
    env.TENNODEV_WORLDSTATE_KV,
    worldState,
    message.force
  );
  const processMessages = buildProcessWorldStateRootMessages(
    {
      runId: message.runId,
      fetchedAt: message.fetchedAt,
      sourceVersion: message.sourceVersion,
      sourceLocale: message.sourceLocale,
      targetLanguages: message.targetLanguages,
      rawSnapshotKey: message.rawSnapshotKey
    },
    analysis.changed.map((item) => ({
      rootKey: item.rootKey,
      previousHash: item.previousHash,
      nextHash: item.nextHash
    }))
  );
  const classification = classifyPushCandidates(analysis.changed);
  await recordPreparedWorldStateRun(env, {
    runId: message.runId,
    fetchedAt: message.fetchedAt,
    sourceVersion: message.sourceVersion,
    rawSnapshotKey: message.rawSnapshotKey,
    changedRootKeys: analysis.changed.map((item) => item.rootKey),
    changedCount: analysis.changed.length,
    queuedCount: processMessages.length,
    force: message.force,
    sourceLocale: message.sourceLocale,
    targetLanguages: message.targetLanguages,
    pushCandidateKeys: classification.pushCandidateKeys,
    nonPushKeys: classification.nonPushKeys
  });
  for (const processMessage of processMessages) {
    await env.TENNODEV_PUSH_QUEUE.send(processMessage);
  }
}
__name(handlePrepareWorldStateRun, "handlePrepareWorldStateRun");
async function handleProcessWorldStateRoot(env, message) {
  const rawPayload = await loadRawSnapshotByKey(env.TENNODEV_WORLDSTATE_KV, message.rawSnapshotKey);
  if (!rawPayload) {
    throw new Error(`Missing raw snapshot for run ${message.runId}`);
  }
  const worldState = parseStoredWorldState(rawPayload);
  const hasRootKey = Object.prototype.hasOwnProperty.call(worldState, message.rootKey);
  const nextValue = hasRootKey ? worldState[message.rootKey] : void 0;
  const previousValue = await loadCurrentRootPayload(env.TENNODEV_WORLDSTATE_KV, message.rootKey);
  const itemChanges = await diffRootItems(message.rootKey, previousValue, nextValue);
  const payload = JSON.stringify(hasRootKey ? nextValue : null);
  const kvKey = await writeRootChange(env, {
    runId: message.runId,
    rootKey: message.rootKey,
    previousHash: message.previousHash,
    nextHash: message.nextHash,
    payload,
    itemChanges
  });
  if (hasRootKey) {
    await saveCurrentRootPayload(env.TENNODEV_WORLDSTATE_KV, message.rootKey, payload);
    await saveLastKnownRootPayload(env.TENNODEV_WORLDSTATE_KV, message.rootKey, payload);
    const translateMessages = buildTranslateQueueMessages(
      {
        runId: message.runId,
        fetchedAt: message.fetchedAt,
        sourceVersion: message.sourceVersion,
        sourceLocale: message.sourceLocale,
        targetLanguages: message.targetLanguages
      },
      [{ rootKey: message.rootKey, payloadKey: kvKey }]
    );
    for (const translateMessage of translateMessages) {
      await env.TENNODEV_PUSH_QUEUE.send(translateMessage);
    }
  } else {
    await deleteCurrentRootPayload(env.TENNODEV_WORLDSTATE_KV, message.rootKey);
  }
}
__name(handleProcessWorldStateRoot, "handleProcessWorldStateRoot");

// src/queue/consumer.ts
async function handleTranslateQueue(batch, env) {
  await ensureQueueTables(env.TENNODEV_WORLDSTATE_D1);
  for (const message of batch.messages) {
    const body = message.body;
    const rootKey = "rootKey" in body ? body.rootKey : "unknown";
    const payloadKey = "payloadKey" in body ? body.payloadKey : "unknown";
    try {
      if (body?.type === "worldstate.prepare-run") {
        await handlePrepareWorldStateRun(env, body);
      } else if (body?.type === "worldstate.process-root") {
        await handleProcessWorldStateRoot(env, body);
      } else if (body?.type === "worldstate.translate-root") {
        await processDummyTranslationMessage(env, body);
      } else {
        throw new Error("Unsupported queue message type");
      }
      message.ack();
    } catch (error) {
      const errText = error instanceof Error ? error.message : "unknown error";
      await logQueueFailed(env.TENNODEV_WORLDSTATE_D1, {
        runId: body?.runId ?? "unknown",
        rootKey,
        payloadKey,
        targetLanguages: body?.targetLanguages ?? [],
        error: errText
      });
      message.retry();
    }
  }
  await pruneOldRuns(env);
}
__name(handleTranslateQueue, "handleTranslateQueue");

// src/index.ts
var app = new Hono2();
registerCoreRoutes(app);
registerWorldStateRoutes(app);
registerDebugRoutes(app);
var src_default = {
  fetch: app.fetch,
  queue: handleTranslateQueue
};

// node_modules/.pnpm/wrangler@4.80.0_@cloudflare+workers-types@4.20260405.1/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// node_modules/.pnpm/wrangler@4.80.0_@cloudflare+workers-types@4.20260405.1/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-UGTFiM/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = src_default;

// node_modules/.pnpm/wrangler@4.80.0_@cloudflare+workers-types@4.20260405.1/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-UGTFiM/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
