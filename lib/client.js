window.__ModuleLoader__.load({ id: "dsh-sensei", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;

"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// client/index.tsx
var index_exports = {};
__export(index_exports, {
  apply: () => apply3,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);

// shared/protocol.ts
var STATE_PATH = "/api/sensei.state";
var OPS_PATH = "/api/sensei.ops";
var SNAPSHOT_PATH = "/api/sensei.snapshot";
var EXPORT_PATH = "/api/sensei.export";
var PROGRESS_PATH = "/api/sensei.progress";
var EXPORT_SCALES = [1, 1.5, 2];
function estimateExportBytes(pages) {
  let chars = 0;
  for (const page of pages) chars += page.png.length;
  return Math.ceil(chars * 3 / 4);
}
function parseDeckDelta(value) {
  const delta = record(value, "delta");
  const revision = integer(delta["revision"], "revision");
  if (revision < 0) return invalid("revision");
  const ops = list(delta["ops"], "ops").map((op) => parseDeckOp(op));
  if (ops.length > revision) return invalid("ops");
  const snapshotRequest = parseSnapshotRequest(delta["snapshotRequest"]);
  const exportRequest = parseExportRequest(delta["exportRequest"]);
  return {
    revision,
    ops,
    ...snapshotRequest === void 0 ? {} : { snapshotRequest },
    ...exportRequest === void 0 ? {} : { exportRequest }
  };
}
function parseSnapshotRequest(value) {
  if (value === void 0) return void 0;
  if (value === null) return null;
  const request = record(value, "snapshotRequest");
  const id = text(request["id"], "snapshotRequest id");
  const slide = integer(request["slide"], "snapshotRequest slide");
  if (slide < 0) return invalid("snapshotRequest slide");
  return { id, slide };
}
function parseExportRequest(value) {
  if (value === void 0) return void 0;
  if (value === null) return null;
  const request = record(value, "exportRequest");
  const id = text(request["id"], "exportRequest id");
  const pages = integer(request["pages"], "exportRequest pages");
  const scale = number(request["scale"], "exportRequest scale");
  if (pages < 1) return invalid("exportRequest pages");
  if (!EXPORT_SCALES.includes(scale)) return invalid("exportRequest scale");
  return { id, pages, scale };
}
function parseDeckOp(value) {
  const op = record(value, "op");
  switch (op["op"]) {
    case "deck": {
      const css = op["css"];
      return {
        op: "deck",
        slides: list(op["slides"], "deck slides").map((slide) => parseSlide(slide)),
        ...css === void 0 ? {} : { css: text(css, "deck css") }
      };
    }
    case "slide":
      return { op: "slide", index: integer(op["index"], "slide index"), slide: parseSlide(op["slide"]) };
    case "show":
      return { op: "show", index: integer(op["index"], "show index") };
    case "annotate":
      return {
        op: "annotate",
        slide: integer(op["slide"], "annotate slide"),
        ops: list(op["ops"], "annotate ops").map((entry) => parseSceneOp(entry))
      };
    case "clear":
      return { op: "clear", slide: integer(op["slide"], "clear slide") };
    case "exported":
      return { op: "exported", path: text(op["path"], "exported path") };
    default:
      return invalid("op tag");
  }
}
function parseSlide(value) {
  const slide = record(value, "slide");
  const title = slide["title"];
  const notes = slide["notes"];
  return {
    html: text(slide["html"], "slide html"),
    ...title === void 0 ? {} : { title: text(title, "slide title") },
    ...notes === void 0 ? {} : { notes: text(notes, "slide notes") }
  };
}
function parseSceneOp(value) {
  const op = record(value, "scene op");
  switch (op["op"]) {
    case "add":
      return { op: "add", element: parseElement(op["element"]) };
    case "patch":
      if (op["isDeleted"] !== true) return invalid("patch isDeleted");
      return { op: "patch", id: text(op["id"], "patch id"), isDeleted: true };
    case "clear":
      return { op: "clear" };
    default:
      return invalid("scene op tag");
  }
}
function parseElement(value) {
  const element = record(value, "element");
  const base = {
    id: text(element["id"], "element id"),
    x: number(element["x"], "element x"),
    y: number(element["y"], "element y"),
    width: number(element["width"], "element width"),
    height: number(element["height"], "element height"),
    strokeColor: text(element["strokeColor"], "element strokeColor"),
    strokeWidth: number(element["strokeWidth"], "element strokeWidth"),
    isDeleted: bool(element["isDeleted"], "element isDeleted")
  };
  const type = text(element["type"], "element type");
  switch (type) {
    case "line":
    case "arrow":
    case "stroke":
      return { ...base, type, points: points(element["points"]) };
    case "rect":
    case "ellipse": {
      const fill = element["fill"];
      return {
        ...base,
        type,
        ...fill === void 0 ? {} : { fill: text(fill, "element fill") }
      };
    }
    case "text": {
      const align = element["align"];
      if (align !== "start" && align !== "middle" && align !== "end") return invalid("element align");
      return {
        ...base,
        type,
        text: text(element["text"], "element text"),
        fontSize: number(element["fontSize"], "element fontSize"),
        align
      };
    }
    default:
      return invalid("element type");
  }
}
function points(value) {
  return list(value, "element points").map((point) => {
    const entry = record(point, "element point");
    return { x: number(entry["x"], "point x"), y: number(entry["y"], "point y") };
  });
}
function readers(fail) {
  const record2 = (value, what) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return fail(what);
    return value;
  };
  const list2 = (value, what) => {
    if (!Array.isArray(value)) return fail(what);
    return value;
  };
  const text3 = (value, what) => {
    if (typeof value !== "string") return fail(what);
    return value;
  };
  const number2 = (value, what) => {
    if (typeof value !== "number" || !Number.isFinite(value)) return fail(what);
    return value;
  };
  const integer2 = (value, what) => {
    if (typeof value !== "number" || !Number.isSafeInteger(value)) return fail(what);
    return value;
  };
  const bool2 = (value, what) => {
    if (typeof value !== "boolean") return fail(what);
    return value;
  };
  return { fail, record: record2, list: list2, text: text3, number: number2, integer: integer2, bool: bool2 };
}
var DECK = readers((what) => {
  throw new Error(`sensei: malformed deck data at ${what}`);
});
var { record, list, text, number, integer, bool } = DECK;
var invalid = DECK.fail;
var wire = readers((what) => {
  throw new Error(`sensei: malformed ops body at ${what}`);
});
var EXPORT = readers((what) => {
  throw new Error(`sensei: malformed export body at ${what}`);
});

// client/locale.ts
var NS = "sensei";
var zh = {
  "view.sensei": "\u8BB2\u6F14",
  "guide.description": "\u5728\u8FD9\u4E00\u680F\u91CC\u8BA9 agent \u8BB2\u4E00\u4EFD\u73B0\u573A\u751F\u6210\u7684\u5E7B\u706F\u7247",
  "panel.empty": "\u8FD8\u6CA1\u6709\u5E7B\u706F\u7247",
  "panel.emptyHint": "agent \u751F\u6210\u5E7B\u706F\u7247\u540E\uFF0C\u5B83\u4F1A\u51FA\u73B0\u5728\u8FD9\u4E00\u680F\u91CC\u3002",
  "nav.prev": "\u4E0A\u4E00\u9875",
  "nav.next": "\u4E0B\u4E00\u9875",
  "nav.position": "\u7B2C {current} / {pages} \u9875",
  "tool.pen": "\u624B\u7ED8",
  "tool.line": "\u76F4\u7EBF",
  "tool.arrow": "\u7BAD\u5934",
  "tool.rect": "\u77E9\u5F62",
  "tool.circle": "\u5706",
  "tool.text": "\u6587\u5B57",
  "tool.textPrompt": "\u6587\u5B57\u5185\u5BB9",
  "tool.color": "\u989C\u8272 {color}",
  "tool.width": "\u7EBF\u5BBD {width}",
  "action.undo": "\u64A4\u9500\u4E0A\u4E00\u7B14",
  "action.clearPage": "\u6E05\u7A7A\u672C\u9875",
  "status.failed": "\u64CD\u4F5C\u5931\u8D25\uFF1A{reason}",
  "status.elements": "\u672C\u9875\u6709 {count} \u4E2A\u5143\u7D20",
  "status.exporting": "\u6B63\u5728\u5BFC\u51FA\u2026",
  "status.exportTooLarge": "\u8FD9\u4E00\u4EFD\u5BFC\u51FA\u7684\u4F53\u79EF\u8D85\u8FC7 64 MiB\uFF0C\u8BF7\u964D\u4F4E scale \u540E\u91CD\u8BD5\u3002",
  "status.lastExport": "\u6700\u8FD1\u4E00\u6B21\u5BFC\u51FA\uFF1A{path}"
};
var en = {
  "view.sensei": "Sensei",
  "guide.description": "Let the agent present a slide deck generated on the spot",
  "panel.empty": "No slides yet",
  "panel.emptyHint": "A deck appears here once the agent creates one.",
  "nav.prev": "Previous slide",
  "nav.next": "Next slide",
  "nav.position": "Slide {current} of {pages}",
  "tool.pen": "Freehand",
  "tool.line": "Line",
  "tool.arrow": "Arrow",
  "tool.rect": "Rectangle",
  "tool.circle": "Circle",
  "tool.text": "Text",
  "tool.textPrompt": "Text to place",
  "tool.color": "Colour {color}",
  "tool.width": "Stroke width {width}",
  "action.undo": "Undo last stroke",
  "action.clearPage": "Clear this slide",
  "status.failed": "Failed: {reason}",
  "status.elements": "This slide has {count} element(s)",
  "status.exporting": "Exporting\u2026",
  "status.exportTooLarge": "This export would exceed 64 MiB; lower the scale and retry.",
  "status.lastExport": "Last export: {path}"
};

// client/panel.tsx
var import_react = require("react");

// vendor/dsh-blackboard/core/assert.ts
function assertNever(value) {
  throw new Error(`unreachable variant: ${JSON.stringify(value)}`);
}

// vendor/dsh-blackboard/core/commands.ts
var PALETTE = ["#1e1e1e", "#e03131", "#2f9e44", "#1971c2", "#f08c00"];
var DEFAULT_COLOR = "#1e1e1e";
var DEFAULT_WIDTH = 4;
var DEFAULT_FONT_SIZE = 32;

// vendor/dsh-blackboard/core/simplify.ts
var MIN_POINT_DISTANCE = 2;
var RDP_EPSILON = 2;
function filterByMinDistance(points2, minDistance) {
  const kept = [];
  for (const point of points2) {
    const previous = kept[kept.length - 1];
    if (previous === void 0 || Math.hypot(point.x - previous.x, point.y - previous.y) >= minDistance) kept.push(point);
  }
  return kept;
}
function reduce(points2, epsilon) {
  const first = points2[0];
  const last = points2[points2.length - 1];
  if (first === void 0 || last === void 0 || points2.length <= 2) return points2;
  const dx = last.x - first.x;
  const dy = last.y - first.y;
  const chord = Math.hypot(dx, dy);
  if (chord === 0) return points2;
  let farthest = -1;
  let index = 0;
  for (let cursor = 1; cursor < points2.length - 1; cursor += 1) {
    const point = points2[cursor];
    if (point === void 0) continue;
    const distance = Math.abs(dy * (point.x - first.x) - dx * (point.y - first.y)) / chord;
    if (distance > farthest) {
      farthest = distance;
      index = cursor;
    }
  }
  if (farthest <= epsilon) return [first, last];
  const head = reduce(points2.slice(0, index + 1), epsilon);
  const tail = reduce(points2.slice(index), epsilon);
  return [...head.slice(0, -1), ...tail];
}
function simplifyRdp(points2, epsilon) {
  return reduce([...points2], epsilon);
}

// core/stage.ts
var STAGE_WIDTH = 1280;
var STAGE_HEIGHT = 720;
function fitStage(width, height) {
  const scale = Math.min(width / STAGE_WIDTH, height / STAGE_HEIGHT);
  return {
    scale,
    offsetX: (width - STAGE_WIDTH * scale) / 2,
    offsetY: (height - STAGE_HEIGHT * scale) / 2
  };
}
function screenToStage(x2, y2, viewport) {
  return {
    x: (x2 - viewport.offsetX) / viewport.scale,
    y: (y2 - viewport.offsetY) / viewport.scale
  };
}
function stageViewport(width, height, dpr) {
  const fit = fitStage(width, height);
  return { scale: fit.scale * dpr, offsetX: fit.offsetX * dpr, offsetY: fit.offsetY * dpr };
}
function pointerToStage(x2, y2, dpr, viewport) {
  return screenToStage(x2 * dpr, y2 * dpr, viewport);
}

// core/annotate.ts
var DEFAULT_ANNOTATE_STYLE = { tool: "pen", color: DEFAULT_COLOR, width: DEFAULT_WIDTH };
function insideStage(point) {
  return point.x >= 0 && point.x <= STAGE_WIDTH && point.y >= 0 && point.y <= STAGE_HEIGHT;
}
function clampToStage(point) {
  return {
    x: Math.min(Math.max(point.x, 0), STAGE_WIDTH),
    y: Math.min(Math.max(point.y, 0), STAGE_HEIGHT)
  };
}
function penPoints(samples) {
  return simplifyRdp(filterByMinDistance(samples, MIN_POINT_DISTANCE), RDP_EPSILON);
}
function commandOf(gesture) {
  switch (gesture.tool) {
    case "pen":
      return { op: "stroke", points: penPoints(gesture.samples), color: gesture.color, width: gesture.width };
    case "line":
      return { op: "line", from: gesture.origin, to: gesture.current, color: gesture.color, width: gesture.width };
    case "arrow":
      return { op: "arrow", from: gesture.origin, to: gesture.current, color: gesture.color, width: gesture.width };
    case "rect":
      return {
        op: "rect",
        at: {
          x: Math.min(gesture.origin.x, gesture.current.x),
          y: Math.min(gesture.origin.y, gesture.current.y)
        },
        size: {
          x: Math.abs(gesture.current.x - gesture.origin.x),
          y: Math.abs(gesture.current.y - gesture.origin.y)
        },
        color: gesture.color,
        width: gesture.width
      };
    case "circle":
      return {
        op: "circle",
        center: gesture.origin,
        radius: Math.hypot(gesture.current.x - gesture.origin.x, gesture.current.y - gesture.origin.y),
        color: gesture.color,
        width: gesture.width
      };
    default:
      return assertNever(gesture.tool);
  }
}
function textCommand(at, text3, color) {
  return { op: "text", at, text: text3, size: DEFAULT_FONT_SIZE, color };
}

// vendor/dsh-blackboard/core/scene.ts
function relativeBox(points2) {
  const first = points2[0] ?? { x: 0, y: 0 };
  let minX = first.x;
  let minY = first.y;
  let maxX = first.x;
  let maxY = first.y;
  for (const point of points2) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
    points: points2.map((point) => ({ x: point.x - minX, y: point.y - minY }))
  };
}
function linearElement(id, type, box, color, width) {
  const common = {
    id,
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    points: box.points,
    strokeColor: color,
    strokeWidth: width,
    isDeleted: false
  };
  return type === "stroke" ? { ...common, type: "stroke" } : { ...common, type };
}
function createScene() {
  return { elements: [], nextId: 0 };
}
function applyCommands(scene, commands) {
  const elements = [...scene.elements];
  let nextId = scene.nextId;
  const add = (create2) => {
    elements.push(create2(`e${nextId}`));
    nextId += 1;
  };
  for (const command of commands) {
    switch (command.op) {
      case "line":
      case "arrow": {
        const box = relativeBox([command.from, command.to]);
        add((id) => linearElement(id, command.op, box, command.color, command.width));
        break;
      }
      case "stroke": {
        const box = relativeBox(command.points);
        add((id) => linearElement(id, "stroke", box, command.color, command.width));
        break;
      }
      case "rect": {
        const x2 = Math.min(command.at.x, command.at.x + command.size.x);
        const y2 = Math.min(command.at.y, command.at.y + command.size.y);
        add((id) => ({
          id,
          type: "rect",
          x: x2,
          y: y2,
          width: Math.abs(command.size.x),
          height: Math.abs(command.size.y),
          strokeColor: command.color,
          strokeWidth: command.width,
          isDeleted: false,
          ...command.fill === void 0 ? {} : { fill: command.fill }
        }));
        break;
      }
      case "circle": {
        const radius = Math.abs(command.radius);
        add((id) => ({
          id,
          type: "ellipse",
          x: command.center.x - radius,
          y: command.center.y - radius,
          width: radius * 2,
          height: radius * 2,
          strokeColor: command.color,
          strokeWidth: command.width,
          isDeleted: false,
          ...command.fill === void 0 ? {} : { fill: command.fill }
        }));
        break;
      }
      case "text":
        add((id) => ({
          id,
          type: "text",
          x: command.at.x,
          y: command.at.y,
          // 文字外接框是渲染期派生数据：这里没有 canvas 可测，所以留 0，真实尺寸由渲染层按字体算。
          width: 0,
          height: 0,
          text: command.text,
          fontSize: command.size,
          align: command.align ?? "start",
          strokeColor: command.color,
          // 文字用填充绘制，没有描边宽度可言。
          strokeWidth: 0,
          isDeleted: false
        }));
        break;
      case "erase": {
        const erased = new Set(command.ids);
        for (let index = 0; index < elements.length; index += 1) {
          const element = elements[index];
          if (element === void 0 || !erased.has(element.id)) continue;
          elements[index] = { ...element, isDeleted: true };
        }
        break;
      }
      case "clear":
        elements.length = 0;
        break;
      default:
        assertNever(command);
    }
  }
  return { elements, nextId };
}

// node_modules/.pnpm/perfect-freehand@1.2.3/node_modules/perfect-freehand/dist/esm/index.mjs
var { PI: e } = Math;
var t = e + 1e-4;
var n = 0.5;
var r = [1, 1];
function i(e2, t2, n2, r2 = (e3) => e3) {
  return e2 * r2(0.5 - t2 * (0.5 - n2));
}
var { min: a } = Math;
function o(e2, t2, n2) {
  let r2 = a(1, t2 / n2);
  return a(1, e2 + (a(1, 1 - r2) - e2) * (r2 * 0.275));
}
function s(e2) {
  return [-e2[0], -e2[1]];
}
function c(e2, t2) {
  return [e2[0] + t2[0], e2[1] + t2[1]];
}
function l(e2, t2, n2) {
  return e2[0] = t2[0] + n2[0], e2[1] = t2[1] + n2[1], e2;
}
function u(e2, t2) {
  return [e2[0] - t2[0], e2[1] - t2[1]];
}
function d(e2, t2, n2) {
  return e2[0] = t2[0] - n2[0], e2[1] = t2[1] - n2[1], e2;
}
function f(e2, t2) {
  return [e2[0] * t2, e2[1] * t2];
}
function p(e2, t2, n2) {
  return e2[0] = t2[0] * n2, e2[1] = t2[1] * n2, e2;
}
function m(e2, t2) {
  return [e2[0] / t2, e2[1] / t2];
}
function h(e2) {
  return [e2[1], -e2[0]];
}
function g(e2, t2) {
  let n2 = t2[0];
  return e2[0] = t2[1], e2[1] = -n2, e2;
}
function ee(e2, t2) {
  return e2[0] * t2[0] + e2[1] * t2[1];
}
function _(e2, t2) {
  return e2[0] === t2[0] && e2[1] === t2[1];
}
function v(e2) {
  return Math.hypot(e2[0], e2[1]);
}
function y(e2, t2) {
  let n2 = e2[0] - t2[0], r2 = e2[1] - t2[1];
  return n2 * n2 + r2 * r2;
}
function b(e2) {
  return m(e2, v(e2));
}
function x(e2, t2) {
  return Math.hypot(e2[1] - t2[1], e2[0] - t2[0]);
}
function S(e2, t2, n2) {
  let r2 = Math.sin(n2), i2 = Math.cos(n2), a2 = e2[0] - t2[0], o2 = e2[1] - t2[1], s2 = a2 * i2 - o2 * r2, c2 = a2 * r2 + o2 * i2;
  return [s2 + t2[0], c2 + t2[1]];
}
function C(e2, t2, n2, r2) {
  let i2 = Math.sin(r2), a2 = Math.cos(r2), o2 = t2[0] - n2[0], s2 = t2[1] - n2[1], c2 = o2 * a2 - s2 * i2, l2 = o2 * i2 + s2 * a2;
  return e2[0] = c2 + n2[0], e2[1] = l2 + n2[1], e2;
}
function w(e2, t2, n2) {
  return c(e2, f(u(t2, e2), n2));
}
function te(e2, t2, n2, r2) {
  let i2 = n2[0] - t2[0], a2 = n2[1] - t2[1];
  return e2[0] = t2[0] + i2 * r2, e2[1] = t2[1] + a2 * r2, e2;
}
function T(e2, t2, n2) {
  return c(e2, f(t2, n2));
}
var E = [0, 0];
var D = [0, 0];
var O = [0, 0];
function k(e2, n2) {
  let r2 = T(e2, b(h(u(e2, c(e2, [1, 1])))), -n2), i2 = [], a2 = 1 / 13;
  for (let n3 = a2; n3 <= 1; n3 += a2) i2.push(S(r2, e2, t * 2 * n3));
  return i2;
}
function A(e2, n2, r2) {
  let i2 = [], a2 = 1 / r2;
  for (let r3 = a2; r3 <= 1; r3 += a2) i2.push(S(n2, e2, t * r3));
  return i2;
}
function j(e2, t2, n2) {
  let r2 = u(t2, n2), i2 = f(r2, 0.5), a2 = f(r2, 0.51);
  return [u(e2, i2), u(e2, a2), c(e2, a2), c(e2, i2)];
}
function M(e2, n2, r2, i2) {
  let a2 = [], o2 = T(e2, n2, r2), s2 = 1 / i2;
  for (let n3 = s2; n3 < 1; n3 += s2) a2.push(S(o2, e2, t * 3 * n3));
  return a2;
}
function ne(e2, t2, n2) {
  return [c(e2, f(t2, n2)), c(e2, f(t2, n2 * 0.99)), u(e2, f(t2, n2 * 0.99)), u(e2, f(t2, n2))];
}
function N(e2, t2, n2) {
  return e2 === false || e2 === void 0 ? 0 : e2 === true ? Math.max(t2, n2) : e2;
}
function re(e2, t2, n2) {
  return e2.slice(0, 10).reduce((e3, r2) => {
    let i2 = r2.pressure;
    return t2 && (i2 = o(e3, r2.distance, n2)), (e3 + i2) / 2;
  }, e2[0].pressure);
}
function P(e2, n2 = {}) {
  let { size: r2 = 16, smoothing: a2 = 0.5, thinning: f2 = 0.5, simulatePressure: m2 = true, easing: _2 = (e3) => e3, start: v2 = {}, end: b2 = {}, last: x2 = false } = n2, { cap: S2 = true, easing: w2 = (e3) => e3 * (2 - e3) } = v2, { cap: T2 = true, easing: P2 = (e3) => --e3 * e3 * e3 + 1 } = b2;
  if (e2.length === 0 || r2 <= 0) return [];
  let F2 = e2[e2.length - 1].runningLength, I2 = N(v2.taper, r2, F2), L2 = N(b2.taper, r2, F2), R2 = (r2 * a2) ** 2, z = [], B = [], V = re(e2, m2, r2), H = i(r2, f2, e2[e2.length - 1].pressure, _2), U, W = e2[0].vector, G = e2[0].point, K = G, q = G, J = K, Y = false;
  for (let n3 = 0; n3 < e2.length; n3++) {
    let { pressure: a3 } = e2[n3], { point: s2, vector: h2, distance: v3, runningLength: b3 } = e2[n3], x3 = n3 === e2.length - 1;
    if (!x3 && F2 - b3 < 3) continue;
    f2 ? (m2 && (a3 = o(V, v3, r2)), H = i(r2, f2, a3, _2)) : H = r2 / 2, U === void 0 && (U = H);
    let S3 = b3 < I2 ? w2(b3 / I2) : 1, T3 = F2 - b3 < L2 ? P2((F2 - b3) / L2) : 1;
    H = Math.max(0.01, H * Math.min(S3, T3));
    let k2 = (x3 ? e2[n3] : e2[n3 + 1]).vector, A2 = x3 ? 1 : ee(h2, k2), j2 = ee(h2, W) < 0 && !Y, M2 = A2 !== null && A2 < 0;
    if (j2 || M2) {
      g(E, W), p(E, E, H);
      for (let e3 = 0; e3 <= 1; e3 += 0.07692307692307693) d(D, s2, E), C(D, D, s2, t * e3), q = [D[0], D[1]], z.push(q), l(O, s2, E), C(O, O, s2, t * -e3), J = [O[0], O[1]], B.push(J);
      G = q, K = J, M2 && (Y = true);
      continue;
    }
    if (Y = false, x3) {
      g(E, h2), p(E, E, H), z.push(u(s2, E)), B.push(c(s2, E));
      continue;
    }
    te(E, k2, h2, A2), g(E, E), p(E, E, H), d(D, s2, E), q = [D[0], D[1]], (n3 <= 1 || y(G, q) > R2) && (z.push(q), G = q), l(O, s2, E), J = [O[0], O[1]], (n3 <= 1 || y(K, J) > R2) && (B.push(J), K = J), V = a3, W = h2;
  }
  let X = [e2[0].point[0], e2[0].point[1]], Z = e2.length > 1 ? [e2[e2.length - 1].point[0], e2[e2.length - 1].point[1]] : c(e2[0].point, [1, 1]), Q = [], $ = [];
  if (e2.length === 1) {
    if (!(I2 || L2) || x2) return k(X, U || H);
  } else {
    I2 || L2 && e2.length === 1 || (S2 ? Q.push(...A(X, B[0], 13)) : Q.push(...j(X, z[0], B[0])));
    let t2 = h(s(e2[e2.length - 1].vector));
    L2 || I2 && e2.length === 1 ? $.push(Z) : T2 ? $.push(...M(Z, t2, H, 29)) : $.push(...ne(Z, t2, H));
  }
  return z.concat($, B.reverse(), Q);
}
var F = [0, 0];
function I(e2) {
  return e2 != null && e2 >= 0;
}
function L(e2, t2 = {}) {
  let { streamline: i2 = 0.5, size: a2 = 16, last: o2 = false } = t2;
  if (e2.length === 0) return [];
  let s2 = 0.15 + (1 - i2) * 0.85, l2 = Array.isArray(e2[0]) ? e2 : e2.map(({ x: e3, y: t3, pressure: r2 = n }) => [e3, t3, r2]);
  if (l2.length === 2) {
    let e3 = l2[1];
    l2 = l2.slice(0, -1);
    for (let t3 = 1; t3 < 5; t3++) l2.push(w(l2[0], e3, t3 / 4));
  }
  l2.length === 1 && (l2 = [...l2, [...c(l2[0], r), ...l2[0].slice(2)]]);
  let u2 = [{ point: [l2[0][0], l2[0][1]], pressure: I(l2[0][2]) ? l2[0][2] : 0.25, vector: [...r], distance: 0, runningLength: 0 }], f2 = false, p2 = 0, m2 = u2[0], h2 = l2.length - 1;
  for (let e3 = 1; e3 < l2.length; e3++) {
    let t3 = o2 && e3 === h2 ? [l2[e3][0], l2[e3][1]] : w(m2.point, l2[e3], s2);
    if (_(m2.point, t3)) continue;
    let r2 = x(t3, m2.point);
    if (p2 += r2, e3 < h2 && !f2) {
      if (p2 < a2) continue;
      f2 = true;
    }
    d(F, m2.point, t3), m2 = { point: t3, pressure: I(l2[e3][2]) ? l2[e3][2] : n, vector: b(F), distance: r2, runningLength: p2 }, u2.push(m2);
  }
  return u2[0].vector = u2[1]?.vector || [0, 0], u2;
}
function R(e2, t2 = {}) {
  return P(L(e2, t2), t2);
}

// vendor/dsh-blackboard/core/render.ts
var STROKE_STYLE = {
  sizeFactor: 2,
  thinning: 0.5,
  smoothing: 0.5,
  streamline: 0.5
};
var ARROW_MIN_LENGTH = 8;
var ARROW_LENGTH_PER_WIDTH = 4;
var ARROW_HALF_ANGLE = Math.PI / 7;
function render(ctx, scene, viewport) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.setTransform(viewport.scale, 0, 0, viewport.scale, viewport.offsetX, viewport.offsetY);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const element of scene.elements) {
    if (element.isDeleted) continue;
    switch (element.type) {
      case "line":
      case "arrow":
        drawLinear(ctx, element);
        break;
      case "rect":
        drawRect(ctx, element);
        break;
      case "ellipse":
        drawEllipse(ctx, element);
        break;
      case "text":
        drawText(ctx, element);
        break;
      case "stroke":
        drawStroke(ctx, element);
        break;
      default:
        assertNever(element);
    }
  }
}
function drawLinear(ctx, element) {
  const points2 = element.points;
  const start = points2[0];
  if (start === void 0) return;
  ctx.strokeStyle = element.strokeColor;
  ctx.lineWidth = element.strokeWidth;
  ctx.beginPath();
  ctx.moveTo(element.x + start.x, element.y + start.y);
  for (const point of points2) ctx.lineTo(element.x + point.x, element.y + point.y);
  ctx.stroke();
  if (element.type === "arrow") drawArrowHead(ctx, element);
}
function drawArrowHead(ctx, element) {
  const tip = element.points[element.points.length - 1];
  const before = element.points[element.points.length - 2];
  if (tip === void 0 || before === void 0) return;
  const tipX = element.x + tip.x;
  const tipY = element.y + tip.y;
  const angle = Math.atan2(tip.y - before.y, tip.x - before.x);
  const length = Math.max(ARROW_MIN_LENGTH, element.strokeWidth * ARROW_LENGTH_PER_WIDTH);
  ctx.fillStyle = element.strokeColor;
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(tipX - length * Math.cos(angle - ARROW_HALF_ANGLE), tipY - length * Math.sin(angle - ARROW_HALF_ANGLE));
  ctx.lineTo(tipX - length * Math.cos(angle + ARROW_HALF_ANGLE), tipY - length * Math.sin(angle + ARROW_HALF_ANGLE));
  ctx.closePath();
  ctx.fill();
}
function drawRect(ctx, element) {
  if (element.fill !== void 0) {
    ctx.fillStyle = element.fill;
    ctx.fillRect(element.x, element.y, element.width, element.height);
  }
  ctx.strokeStyle = element.strokeColor;
  ctx.lineWidth = element.strokeWidth;
  ctx.strokeRect(element.x, element.y, element.width, element.height);
}
function drawEllipse(ctx, element) {
  ctx.beginPath();
  ctx.ellipse(element.x + element.width / 2, element.y + element.height / 2, element.width / 2, element.height / 2, 0, 0, 2 * Math.PI);
  if (element.fill !== void 0) {
    ctx.fillStyle = element.fill;
    ctx.fill();
  }
  ctx.strokeStyle = element.strokeColor;
  ctx.lineWidth = element.strokeWidth;
  ctx.stroke();
}
function drawText(ctx, element) {
  ctx.font = `${element.fontSize}px sans-serif`;
  ctx.textAlign = element.align === "middle" ? "center" : element.align;
  ctx.textBaseline = "middle";
  ctx.fillStyle = element.strokeColor;
  ctx.fillText(element.text, element.x, element.y);
}
function drawStroke(ctx, element) {
  const outline = R(
    element.points.map((point) => [element.x + point.x, element.y + point.y]),
    {
      size: element.strokeWidth * STROKE_STYLE.sizeFactor,
      thinning: STROKE_STYLE.thinning,
      smoothing: STROKE_STYLE.smoothing,
      streamline: STROKE_STYLE.streamline,
      simulatePressure: true,
      last: true
    }
  );
  const start = outline[0];
  if (start === void 0) return;
  ctx.beginPath();
  ctx.moveTo(start[0], start[1]);
  for (const point of outline) ctx.lineTo(point[0], point[1]);
  ctx.closePath();
  ctx.fillStyle = element.strokeColor;
  ctx.fill();
}

// client/annotator.ts
function context2d(canvas) {
  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("sensei: the browser returned no 2D context");
  return ctx;
}
function mountAnnotator(host) {
  const canvas = host.canvas;
  const ctx = context2d(canvas);
  let scene = createScene();
  let gesture;
  const redraw = () => {
    const viewport = host.viewport();
    const shown = gesture === void 0 ? scene : applyCommands(scene, [commandOf(gesture)]);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.beginPath();
    ctx.rect(viewport.offsetX, viewport.offsetY, STAGE_WIDTH * viewport.scale, STAGE_HEIGHT * viewport.scale);
    ctx.clip();
    render(ctx, shown, viewport);
    ctx.restore();
  };
  const toStage = (event) => {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
    return pointerToStage(event.clientX - rect.left, event.clientY - rect.top, dpr, host.viewport());
  };
  const onPointerDown = (event) => {
    if (event.button !== 0) return;
    const point = toStage(event);
    if (!insideStage(point)) return;
    const style = host.style();
    event.preventDefault();
    if (style.tool === "text") {
      const text3 = host.askText();
      if (text3 === null || text3 === "") return;
      host.onCommand(textCommand(point, text3, style.color));
      return;
    }
    canvas.setPointerCapture(event.pointerId);
    gesture = {
      pointerId: event.pointerId,
      tool: style.tool,
      color: style.color,
      width: style.width,
      origin: point,
      current: point,
      samples: [point]
    };
    redraw();
  };
  const onPointerMove = (event) => {
    if (gesture === void 0 || event.pointerId !== gesture.pointerId) return;
    const point = clampToStage(toStage(event));
    gesture.current = point;
    if (gesture.tool === "pen") gesture.samples.push(point);
    redraw();
  };
  const onPointerUp = (event) => {
    if (gesture === void 0 || event.pointerId !== gesture.pointerId) return;
    gesture.current = clampToStage(toStage(event));
    if (gesture.tool === "pen") gesture.samples.push(gesture.current);
    const command = commandOf(gesture);
    gesture = void 0;
    redraw();
    host.onCommand(command);
  };
  const onPointerCancel = () => {
    if (gesture === void 0) return;
    gesture = void 0;
    redraw();
  };
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerCancel);
  const stopLayout = host.onLayout(redraw);
  redraw();
  return {
    update: (next) => {
      scene = next;
      redraw();
    },
    dispose: () => {
      stopLayout();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerCancel);
      gesture = void 0;
    }
  };
}

// core/document.ts
var SLIDE_CSP = [
  "default-src 'none'",
  "script-src 'none'",
  "style-src 'unsafe-inline'",
  "img-src data:",
  "font-src data:",
  "media-src data:",
  "connect-src 'none'",
  "frame-src 'none'",
  "form-action 'none'",
  "base-uri 'none'"
].join("; ");
var BASE_CSS = `.sensei-slide {
  width: 1280px;
  height: 720px;
  margin: 0;
  padding: 0;
  box-sizing: border-box;
  overflow: hidden;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
}
html, body {
  margin: 0;
  padding: 0;
  background: transparent;
}
`;
function renderDocument(slide, css) {
  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${SLIDE_CSP}">
<style>${BASE_CSS}${css}</style>
</head><body><div class="sensei-slide">${slide.html}</div></body></html>
`;
}

// node_modules/.pnpm/dompurify@3.4.17/node_modules/dompurify/dist/purify.es.mjs
function _OverloadYield(e2, d2) {
  this.v = e2, this.k = d2;
}
function _arrayLikeToArray(r2, a2) {
  (null == a2 || a2 > r2.length) && (a2 = r2.length);
  for (var e2 = 0, n2 = Array(a2); e2 < a2; e2++) n2[e2] = r2[e2];
  return n2;
}
function _arrayWithHoles(r2) {
  if (Array.isArray(r2)) return r2;
}
function _iterableToArrayLimit(r2, l2) {
  var t2 = null == r2 ? null : "undefined" != typeof Symbol && r2[Symbol.iterator] || r2["@@iterator"];
  if (null != t2) {
    var e2, n2, i2, u2, a2 = [], f2 = true, o2 = false;
    try {
      if (i2 = (t2 = t2.call(r2)).next, 0 === l2) {
        if (Object(t2) !== t2) return;
        f2 = false;
      } else for (; !(f2 = (e2 = i2.call(t2)).done) && (a2.push(e2.value), a2.length !== l2); f2 = true) ;
    } catch (r3) {
      o2 = true, n2 = r3;
    } finally {
      try {
        if (!f2 && null != t2.return && (u2 = t2.return(), Object(u2) !== u2)) return;
      } finally {
        if (o2) throw n2;
      }
    }
    return a2;
  }
}
function _nonIterableRest() {
  throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
}
function _slicedToArray(r2, e2) {
  return _arrayWithHoles(r2) || _iterableToArrayLimit(r2, e2) || _unsupportedIterableToArray(r2, e2) || _nonIterableRest();
}
function _unsupportedIterableToArray(r2, a2) {
  if (r2) {
    if ("string" == typeof r2) return _arrayLikeToArray(r2, a2);
    var t2 = {}.toString.call(r2).slice(8, -1);
    return "Object" === t2 && r2.constructor && (t2 = r2.constructor.name), "Map" === t2 || "Set" === t2 ? Array.from(r2) : "Arguments" === t2 || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t2) ? _arrayLikeToArray(r2, a2) : void 0;
  }
}
function AsyncGenerator(e2) {
  var t2, n2;
  function resume(t3, n3) {
    try {
      var r2 = e2[t3](n3), o2 = r2.value, u2 = o2 instanceof _OverloadYield;
      Promise.resolve(u2 ? o2.v : o2).then(function(n4) {
        if (u2) {
          var i2 = "return" === t3 && o2.k ? t3 : "next";
          if (!o2.k || n4.done) return resume(i2, n4);
          n4 = e2[i2](n4).value;
        }
        settle(!!r2.done, n4);
      }, function(e3) {
        resume("throw", e3);
      });
    } catch (e3) {
      settle(2, e3);
    }
  }
  function settle(e3, r2) {
    2 === e3 ? t2.reject(r2) : t2.resolve({
      value: r2,
      done: e3
    }), (t2 = t2.next) ? resume(t2.key, t2.arg) : n2 = null;
  }
  this._invoke = function(e3, r2) {
    return new Promise(function(o2, u2) {
      var i2 = {
        key: e3,
        arg: r2,
        resolve: o2,
        reject: u2,
        next: null
      };
      n2 ? n2 = n2.next = i2 : (t2 = n2 = i2, resume(e3, r2));
    });
  }, "function" != typeof e2.return && (this.return = void 0);
}
AsyncGenerator.prototype["function" == typeof Symbol && Symbol.asyncIterator || "@@asyncIterator"] = function() {
  return this;
}, AsyncGenerator.prototype.next = function(e2) {
  return this._invoke("next", e2);
}, AsyncGenerator.prototype.throw = function(e2) {
  return this._invoke("throw", e2);
}, AsyncGenerator.prototype.return = function(e2) {
  return this._invoke("return", e2);
};
var entries = Object.entries;
var setPrototypeOf = Object.setPrototypeOf;
var isFrozen = Object.isFrozen;
var getPrototypeOf = Object.getPrototypeOf;
var getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
var freeze = Object.freeze;
var seal = Object.seal;
var create = Object.create;
var _ref = typeof Reflect !== "undefined" && Reflect;
var apply = _ref.apply;
var construct = _ref.construct;
if (!freeze) freeze = function freeze2(x2) {
  return x2;
};
if (!seal) seal = function seal2(x2) {
  return x2;
};
if (!apply) apply = function apply2(func, thisArg) {
  for (var _len = arguments.length, args = new Array(_len > 2 ? _len - 2 : 0), _key = 2; _key < _len; _key++) args[_key - 2] = arguments[_key];
  return func.apply(thisArg, args);
};
if (!construct) construct = function construct2(Func) {
  for (var _len2 = arguments.length, args = new Array(_len2 > 1 ? _len2 - 1 : 0), _key2 = 1; _key2 < _len2; _key2++) args[_key2 - 1] = arguments[_key2];
  return new Func(...args);
};
var arrayForEach = unapply(Array.prototype.forEach);
Array.prototype.indexOf;
var arrayLastIndexOf = unapply(Array.prototype.lastIndexOf);
var arrayPop = unapply(Array.prototype.pop);
var arrayPush = unapply(Array.prototype.push);
var arraySlice = unapply(Array.prototype.slice);
var arraySplice = unapply(Array.prototype.splice);
var arrayIsArray = Array.isArray;
var setCreate = unconstruct(Set);
var setAdd = unapply(Set.prototype.add);
var setHas = unapply(Set.prototype.has);
var stringToLowerCase = unapply(String.prototype.toLowerCase);
var stringToString = unapply(String.prototype.toString);
var stringMatch = unapply(String.prototype.match);
var stringReplace = unapply(String.prototype.replace);
var stringIndexOf = unapply(String.prototype.indexOf);
var stringTrim = unapply(String.prototype.trim);
var numberToString = unapply(Number.prototype.toString);
var booleanToString = unapply(Boolean.prototype.toString);
var bigintToString = typeof BigInt === "undefined" ? null : unapply(BigInt.prototype.toString);
var symbolToString = typeof Symbol === "undefined" ? null : unapply(Symbol.prototype.toString);
var objectHasOwnProperty = unapply(Object.prototype.hasOwnProperty);
var objectToString = unapply(Object.prototype.toString);
var regExpTest = unapply(RegExp.prototype.test);
var typeErrorCreate = unconstruct(TypeError);
function unapply(func) {
  return function(thisArg) {
    if (thisArg instanceof RegExp) thisArg.lastIndex = 0;
    for (var _len3 = arguments.length, args = new Array(_len3 > 1 ? _len3 - 1 : 0), _key3 = 1; _key3 < _len3; _key3++) args[_key3 - 1] = arguments[_key3];
    return apply(func, thisArg, args);
  };
}
function unconstruct(Func) {
  return function() {
    for (var _len4 = arguments.length, args = new Array(_len4), _key4 = 0; _key4 < _len4; _key4++) args[_key4] = arguments[_key4];
    return construct(Func, args);
  };
}
function addToSet(set, array) {
  let transformCaseFunc = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : stringToLowerCase;
  if (setPrototypeOf) setPrototypeOf(set, null);
  if (!arrayIsArray(array)) return set;
  let l2 = array.length;
  while (l2--) {
    let element = array[l2];
    if (typeof element === "string") {
      const lcElement = transformCaseFunc(element);
      if (lcElement !== element) {
        if (!isFrozen(array)) array[l2] = lcElement;
        element = lcElement;
      }
    }
    set[element] = true;
  }
  return set;
}
function cleanArray(array) {
  for (let index = 0; index < array.length; index++) if (!objectHasOwnProperty(array, index)) array[index] = null;
  return array;
}
function clone(object) {
  const newObject = create(null);
  for (const _ref2 of entries(object)) {
    var _ref3 = _slicedToArray(_ref2, 2);
    const property = _ref3[0];
    const value = _ref3[1];
    if (objectHasOwnProperty(object, property)) {
      if (arrayIsArray(value)) newObject[property] = cleanArray(value);
      else if (value && typeof value === "object" && value.constructor === Object) newObject[property] = clone(value);
      else newObject[property] = value;
    }
  }
  return newObject;
}
function stringifyValue(value) {
  switch (typeof value) {
    case "string":
      return value;
    case "number":
      return numberToString(value);
    case "boolean":
      return booleanToString(value);
    case "bigint":
      return bigintToString ? bigintToString(value) : "0";
    case "symbol":
      return symbolToString ? symbolToString(value) : "Symbol()";
    case "undefined":
      return objectToString(value);
    case "function":
    case "object": {
      if (value === null) return objectToString(value);
      const valueAsRecord = value;
      const valueToString = lookupGetter(valueAsRecord, "toString");
      if (typeof valueToString === "function") {
        const stringified = valueToString(valueAsRecord);
        return typeof stringified === "string" ? stringified : objectToString(stringified);
      }
      return objectToString(value);
    }
    default:
      return objectToString(value);
  }
}
function lookupGetter(object, prop) {
  while (object !== null) {
    const desc = getOwnPropertyDescriptor(object, prop);
    if (desc) {
      if (desc.get) return unapply(desc.get);
      if (typeof desc.value === "function") return unapply(desc.value);
    }
    object = getPrototypeOf(object);
  }
  function fallbackValue() {
    return null;
  }
  return fallbackValue;
}
function lookupAccessor(object, prop) {
  while (object !== null) {
    const desc = getOwnPropertyDescriptor(object, prop);
    if (desc) return desc.get ? unapply(desc.get) : null;
    object = getPrototypeOf(object);
  }
  return null;
}
function isRegex(value) {
  try {
    regExpTest(value, "");
    return true;
  } catch (_unused) {
    return false;
  }
}
var html$1 = freeze([
  "a",
  "abbr",
  "acronym",
  "address",
  "area",
  "article",
  "aside",
  "audio",
  "b",
  "bdi",
  "bdo",
  "big",
  "blink",
  "blockquote",
  "body",
  "br",
  "button",
  "canvas",
  "caption",
  "center",
  "cite",
  "code",
  "col",
  "colgroup",
  "content",
  "data",
  "datalist",
  "dd",
  "decorator",
  "del",
  "details",
  "dfn",
  "dialog",
  "dir",
  "div",
  "dl",
  "dt",
  "element",
  "em",
  "fieldset",
  "figcaption",
  "figure",
  "font",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "head",
  "header",
  "hgroup",
  "hr",
  "html",
  "i",
  "img",
  "input",
  "ins",
  "kbd",
  "label",
  "legend",
  "li",
  "main",
  "map",
  "mark",
  "marquee",
  "menu",
  "menuitem",
  "meter",
  "nav",
  "nobr",
  "ol",
  "optgroup",
  "option",
  "output",
  "p",
  "picture",
  "pre",
  "progress",
  "q",
  "rp",
  "rt",
  "ruby",
  "s",
  "samp",
  "search",
  "section",
  "select",
  "shadow",
  "slot",
  "small",
  "source",
  "spacer",
  "span",
  "strike",
  "strong",
  "style",
  "sub",
  "summary",
  "sup",
  "table",
  "tbody",
  "td",
  "template",
  "textarea",
  "tfoot",
  "th",
  "thead",
  "time",
  "tr",
  "track",
  "tt",
  "u",
  "ul",
  "var",
  "video",
  "wbr"
]);
var svg$1 = freeze([
  "svg",
  "a",
  "altglyph",
  "altglyphdef",
  "altglyphitem",
  "animatecolor",
  "animatemotion",
  "animatetransform",
  "circle",
  "clippath",
  "defs",
  "desc",
  "ellipse",
  "enterkeyhint",
  "exportparts",
  "filter",
  "font",
  "g",
  "glyph",
  "glyphref",
  "hkern",
  "image",
  "inputmode",
  "line",
  "lineargradient",
  "marker",
  "mask",
  "metadata",
  "mpath",
  "part",
  "path",
  "pattern",
  "polygon",
  "polyline",
  "radialgradient",
  "rect",
  "stop",
  "style",
  "switch",
  "symbol",
  "text",
  "textpath",
  "title",
  "tref",
  "tspan",
  "view",
  "vkern"
]);
var svgFilters = freeze([
  "feBlend",
  "feColorMatrix",
  "feComponentTransfer",
  "feComposite",
  "feConvolveMatrix",
  "feDiffuseLighting",
  "feDisplacementMap",
  "feDistantLight",
  "feDropShadow",
  "feFlood",
  "feFuncA",
  "feFuncB",
  "feFuncG",
  "feFuncR",
  "feGaussianBlur",
  "feImage",
  "feMerge",
  "feMergeNode",
  "feMorphology",
  "feOffset",
  "fePointLight",
  "feSpecularLighting",
  "feSpotLight",
  "feTile",
  "feTurbulence"
]);
var svgDisallowed = freeze([
  "animate",
  "color-profile",
  "cursor",
  "discard",
  "font-face",
  "font-face-format",
  "font-face-name",
  "font-face-src",
  "font-face-uri",
  "foreignobject",
  "hatch",
  "hatchpath",
  "mesh",
  "meshgradient",
  "meshpatch",
  "meshrow",
  "missing-glyph",
  "script",
  "set",
  "solidcolor",
  "unknown",
  "use"
]);
var mathMl$1 = freeze([
  "math",
  "menclose",
  "merror",
  "mfenced",
  "mfrac",
  "mglyph",
  "mi",
  "mlabeledtr",
  "mmultiscripts",
  "mn",
  "mo",
  "mover",
  "mpadded",
  "mphantom",
  "mroot",
  "mrow",
  "ms",
  "mspace",
  "msqrt",
  "mstyle",
  "msub",
  "msup",
  "msubsup",
  "mtable",
  "mtd",
  "mtext",
  "mtr",
  "munder",
  "munderover",
  "mprescripts"
]);
var mathMlDisallowed = freeze([
  "maction",
  "maligngroup",
  "malignmark",
  "mlongdiv",
  "mscarries",
  "mscarry",
  "msgroup",
  "mstack",
  "msline",
  "msrow",
  "semantics",
  "annotation",
  "annotation-xml",
  "mprescripts",
  "none"
]);
var text2 = freeze(["#text"]);
var html = freeze([
  "accept",
  "action",
  "align",
  "alt",
  "autocapitalize",
  "autocomplete",
  "autopictureinpicture",
  "autoplay",
  "background",
  "bgcolor",
  "border",
  "capture",
  "cellpadding",
  "cellspacing",
  "checked",
  "cite",
  "class",
  "clear",
  "color",
  "cols",
  "colspan",
  "command",
  "commandfor",
  "controls",
  "controlslist",
  "coords",
  "crossorigin",
  "datetime",
  "decoding",
  "default",
  "dir",
  "disabled",
  "disablepictureinpicture",
  "disableremoteplayback",
  "download",
  "draggable",
  "enctype",
  "enterkeyhint",
  "exportparts",
  "face",
  "for",
  "headers",
  "height",
  "hidden",
  "high",
  "href",
  "hreflang",
  "id",
  "inert",
  "inputmode",
  "integrity",
  "ismap",
  "kind",
  "label",
  "lang",
  "list",
  "loading",
  "loop",
  "low",
  "max",
  "maxlength",
  "media",
  "method",
  "min",
  "minlength",
  "multiple",
  "muted",
  "name",
  "nonce",
  "noshade",
  "novalidate",
  "nowrap",
  "open",
  "optimum",
  "part",
  "pattern",
  "placeholder",
  "playsinline",
  "popover",
  "popovertarget",
  "popovertargetaction",
  "poster",
  "preload",
  "pubdate",
  "radiogroup",
  "readonly",
  "rel",
  "required",
  "rev",
  "reversed",
  "role",
  "rows",
  "rowspan",
  "spellcheck",
  "scope",
  "selected",
  "shape",
  "size",
  "sizes",
  "slot",
  "span",
  "srclang",
  "start",
  "src",
  "srcset",
  "step",
  "style",
  "summary",
  "tabindex",
  "title",
  "translate",
  "type",
  "usemap",
  "valign",
  "value",
  "width",
  "wrap",
  "xmlns"
]);
var svg = freeze([
  "accent-height",
  "accumulate",
  "additive",
  "alignment-baseline",
  "amplitude",
  "ascent",
  "attributename",
  "attributetype",
  "azimuth",
  "basefrequency",
  "baseline-shift",
  "begin",
  "bias",
  "by",
  "class",
  "clip",
  "clippathunits",
  "clip-path",
  "clip-rule",
  "color",
  "color-interpolation",
  "color-interpolation-filters",
  "color-profile",
  "color-rendering",
  "cx",
  "cy",
  "d",
  "dx",
  "dy",
  "diffuseconstant",
  "direction",
  "display",
  "divisor",
  "dominant-baseline",
  "dur",
  "edgemode",
  "elevation",
  "end",
  "exponent",
  "fill",
  "fill-opacity",
  "fill-rule",
  "filter",
  "filterunits",
  "flood-color",
  "flood-opacity",
  "font-family",
  "font-size",
  "font-size-adjust",
  "font-stretch",
  "font-style",
  "font-variant",
  "font-weight",
  "fx",
  "fy",
  "g1",
  "g2",
  "glyph-name",
  "glyphref",
  "gradientunits",
  "gradienttransform",
  "height",
  "href",
  "id",
  "image-rendering",
  "in",
  "in2",
  "intercept",
  "k",
  "k1",
  "k2",
  "k3",
  "k4",
  "kerning",
  "keypoints",
  "keysplines",
  "keytimes",
  "lang",
  "lengthadjust",
  "letter-spacing",
  "kernelmatrix",
  "kernelunitlength",
  "lighting-color",
  "local",
  "marker-end",
  "marker-mid",
  "marker-start",
  "markerheight",
  "markerunits",
  "markerwidth",
  "maskcontentunits",
  "maskunits",
  "max",
  "mask",
  "mask-type",
  "media",
  "method",
  "mode",
  "min",
  "name",
  "numoctaves",
  "offset",
  "operator",
  "opacity",
  "order",
  "orient",
  "orientation",
  "origin",
  "overflow",
  "paint-order",
  "path",
  "pathlength",
  "patterncontentunits",
  "patterntransform",
  "patternunits",
  "pointer-events",
  "points",
  "preservealpha",
  "preserveaspectratio",
  "primitiveunits",
  "r",
  "rx",
  "ry",
  "radius",
  "refx",
  "refy",
  "repeatcount",
  "repeatdur",
  "restart",
  "result",
  "rotate",
  "scale",
  "seed",
  "shape-rendering",
  "slope",
  "specularconstant",
  "specularexponent",
  "spreadmethod",
  "startoffset",
  "stddeviation",
  "stitchtiles",
  "stop-color",
  "stop-opacity",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "stroke-opacity",
  "stroke",
  "stroke-width",
  "style",
  "surfacescale",
  "systemlanguage",
  "tabindex",
  "tablevalues",
  "targetx",
  "targety",
  "transform",
  "transform-origin",
  "text-anchor",
  "text-decoration",
  "text-orientation",
  "text-rendering",
  "textlength",
  "type",
  "u1",
  "u2",
  "unicode",
  "values",
  "vector-effect",
  "viewbox",
  "visibility",
  "version",
  "vert-adv-y",
  "vert-origin-x",
  "vert-origin-y",
  "width",
  "word-spacing",
  "wrap",
  "writing-mode",
  "xchannelselector",
  "ychannelselector",
  "x",
  "x1",
  "x2",
  "xmlns",
  "y",
  "y1",
  "y2",
  "z",
  "zoomandpan"
]);
var mathMl = freeze([
  "accent",
  "accentunder",
  "align",
  "bevelled",
  "close",
  "columnalign",
  "columnlines",
  "columnspacing",
  "columnspan",
  "denomalign",
  "depth",
  "dir",
  "display",
  "displaystyle",
  "encoding",
  "fence",
  "frame",
  "height",
  "href",
  "id",
  "largeop",
  "length",
  "linethickness",
  "lquote",
  "lspace",
  "mathbackground",
  "mathcolor",
  "mathsize",
  "mathvariant",
  "maxsize",
  "minsize",
  "movablelimits",
  "notation",
  "numalign",
  "open",
  "rowalign",
  "rowlines",
  "rowspacing",
  "rowspan",
  "rspace",
  "rquote",
  "scriptlevel",
  "scriptminsize",
  "scriptsizemultiplier",
  "selection",
  "separator",
  "separators",
  "stretchy",
  "subscriptshift",
  "supscriptshift",
  "symmetric",
  "voffset",
  "width",
  "xmlns"
]);
var xml = freeze([
  "xlink:href",
  "xml:id",
  "xlink:title",
  "xml:space",
  "xmlns:xlink"
]);
var MUSTACHE_EXPR = seal(/{{[\w\W]*|^[\w\W]*}}/g);
var ERB_EXPR = seal(/<%[\w\W]*|^[\w\W]*%>/g);
var TMPLIT_EXPR = seal(/\${[\w\W]*/g);
var DATA_ATTR = seal(/^data-[\-\w.\u00B7-\uFFFF]+$/);
var ARIA_ATTR = seal(/^aria-[\-\w]+$/);
var IS_ALLOWED_URI = seal(/^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|matrix):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i);
var IS_SCRIPT_OR_DATA = seal(/^(?:\w+script|data):/i);
var ATTR_WHITESPACE = seal(/[\u0000-\u0020\u00A0\u1680\u180E\u2000-\u2029\u205F\u3000]/g);
var DOCTYPE_NAME = seal(/^html$/i);
var CUSTOM_ELEMENT = seal(/^[a-z][.\w]*(-[.\w]+)+$/i);
var ELEMENT_MARKUP_PROBE = seal(/<[/\w!]/g);
var COMMENT_MARKUP_PROBE = seal(/<[/\w]/g);
var FALLBACK_TAG_CLOSE = seal(/<\/no(script|embed|frames)/i);
var SELF_CLOSING_TAG = seal(/\/>/i);
var NODE_TYPE = {
  element: 1,
  attribute: 2,
  text: 3,
  cdataSection: 4,
  entityReference: 5,
  entityNode: 6,
  processingInstruction: 7,
  comment: 8,
  document: 9,
  documentType: 10,
  documentFragment: 11,
  notation: 12
};
var LITERAL_TEXT_ELEMENTS = freeze(addToSet({}, [
  "style",
  "script",
  "xmp",
  "iframe",
  "noembed",
  "noframes",
  "plaintext",
  "noscript"
]));
var getGlobal = function getGlobal2() {
  return typeof window === "undefined" ? null : window;
};
var _createTrustedTypesPolicy = function _createTrustedTypesPolicy2(trustedTypes, purifyHostElement) {
  if (typeof trustedTypes !== "object" || typeof trustedTypes.createPolicy !== "function") return null;
  let suffix = null;
  const ATTR_NAME = "data-tt-policy-suffix";
  if (purifyHostElement && purifyHostElement.hasAttribute(ATTR_NAME)) suffix = purifyHostElement.getAttribute(ATTR_NAME);
  const policyName = "dompurify" + (suffix ? "#" + suffix : "");
  try {
    return trustedTypes.createPolicy(policyName, {
      createHTML(html2) {
        return html2;
      },
      createScriptURL(scriptUrl) {
        return scriptUrl;
      }
    });
  } catch (_2) {
    console.warn("TrustedTypes policy " + policyName + " could not be created.");
    return null;
  }
};
var _createHooksMap = function _createHooksMap2() {
  return {
    afterSanitizeAttributes: [],
    afterSanitizeElements: [],
    afterSanitizeShadowDOM: [],
    beforeSanitizeAttributes: [],
    beforeSanitizeElements: [],
    beforeSanitizeShadowDOM: [],
    uponSanitizeAttribute: [],
    uponSanitizeElement: [],
    uponSanitizeShadowNode: []
  };
};
var _resolveSetOption = function _resolveSetOption2(cfg, key, fallback, options) {
  return objectHasOwnProperty(cfg, key) && arrayIsArray(cfg[key]) ? addToSet(options.base ? clone(options.base) : {}, cfg[key], options.transform) : fallback;
};
var _resolveObjectOption = function _resolveObjectOption2(cfg, key, makeFallback) {
  const value = objectHasOwnProperty(cfg, key) ? cfg[key] : void 0;
  return value && typeof value === "object" ? clone(value) : makeFallback();
};
function createDOMPurify() {
  let window2 = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : getGlobal();
  const DOMPurify = (root) => createDOMPurify(root);
  DOMPurify.version = "3.4.17";
  DOMPurify.removed = [];
  if (!window2 || !window2.document || window2.document.nodeType !== NODE_TYPE.document || !window2.Element) {
    DOMPurify.isSupported = false;
    return DOMPurify;
  }
  let document2 = window2.document;
  const originalDocument = document2;
  const currentScript = originalDocument.currentScript;
  window2.DocumentFragment;
  const HTMLTemplateElement = window2.HTMLTemplateElement, Node = window2.Node, Element = window2.Element, NodeFilter = window2.NodeFilter;
  window2.NamedNodeMap === void 0 && (window2.NamedNodeMap || window2.MozNamedAttrMap);
  window2.HTMLFormElement;
  const DOMParser2 = window2.DOMParser, trustedTypes = window2.trustedTypes;
  const ElementPrototype = Element.prototype;
  const cloneNode = lookupGetter(ElementPrototype, "cloneNode");
  const remove = lookupGetter(ElementPrototype, "remove");
  const removeAttributeNode = lookupGetter(ElementPrototype, "removeAttributeNode");
  const getNextSibling = lookupGetter(ElementPrototype, "nextSibling");
  const getChildNodes = lookupGetter(ElementPrototype, "childNodes");
  const getParentNode = lookupGetter(ElementPrototype, "parentNode");
  const getShadowRoot = lookupGetter(ElementPrototype, "shadowRoot");
  const getAttributes = lookupGetter(ElementPrototype, "attributes");
  const getNodeType = Node && Node.prototype ? lookupGetter(Node.prototype, "nodeType") : null;
  const getNodeName = Node && Node.prototype ? lookupGetter(Node.prototype, "nodeName") : null;
  const getOwnerDocument = Node && Node.prototype ? lookupGetter(Node.prototype, "ownerDocument") : null;
  const _readNodeType = function _readNodeType2(node) {
    return getNodeType ? getNodeType(node) : node.nodeType;
  };
  const _readNodeName = function _readNodeName2(node) {
    return getNodeName ? getNodeName(node) : node.nodeName;
  };
  const getNamespaceURI = lookupAccessor(ElementPrototype, "namespaceURI");
  const _readNamespaceURI = function _readNamespaceURI2(element) {
    return getNamespaceURI ? getNamespaceURI(element) : element.namespaceURI;
  };
  if (typeof HTMLTemplateElement === "function") {
    const template = document2.createElement("template");
    if (template.content && template.content.ownerDocument) document2 = template.content.ownerDocument;
  }
  let trustedTypesPolicy;
  let emptyHTML = "";
  let defaultTrustedTypesPolicy;
  let defaultTrustedTypesPolicyResolved = false;
  let IN_TRUSTED_TYPES_POLICY = 0;
  const _assertNotInTrustedTypesPolicy = function _assertNotInTrustedTypesPolicy2() {
    if (IN_TRUSTED_TYPES_POLICY > 0) throw typeErrorCreate('A configured TRUSTED_TYPES_POLICY callback (createHTML or createScriptURL) must not call DOMPurify.sanitize, as that causes infinite recursion. Do not pass a policy whose callbacks wrap DOMPurify as TRUSTED_TYPES_POLICY; see the "DOMPurify and Trusted Types" section of the README.');
  };
  const _createTrustedHTML = function _createTrustedHTML2(html2) {
    _assertNotInTrustedTypesPolicy();
    IN_TRUSTED_TYPES_POLICY++;
    try {
      return trustedTypesPolicy.createHTML(html2);
    } finally {
      IN_TRUSTED_TYPES_POLICY--;
    }
  };
  const _createTrustedScriptURL = function _createTrustedScriptURL2(scriptUrl) {
    _assertNotInTrustedTypesPolicy();
    IN_TRUSTED_TYPES_POLICY++;
    try {
      return trustedTypesPolicy.createScriptURL(scriptUrl);
    } finally {
      IN_TRUSTED_TYPES_POLICY--;
    }
  };
  const _getDefaultTrustedTypesPolicy = function _getDefaultTrustedTypesPolicy2() {
    if (!defaultTrustedTypesPolicyResolved) {
      defaultTrustedTypesPolicy = _createTrustedTypesPolicy(trustedTypes, currentScript);
      defaultTrustedTypesPolicyResolved = true;
    }
    return defaultTrustedTypesPolicy;
  };
  const _document = document2, implementation = _document.implementation, createNodeIterator = _document.createNodeIterator, createDocumentFragment = _document.createDocumentFragment, getElementsByTagName = _document.getElementsByTagName;
  const importNode = originalDocument.importNode;
  let hooks = _createHooksMap();
  DOMPurify.isSupported = typeof entries === "function" && typeof getParentNode === "function" && implementation && implementation.createHTMLDocument !== void 0;
  const MUSTACHE_EXPR$1 = MUSTACHE_EXPR, ERB_EXPR$1 = ERB_EXPR, TMPLIT_EXPR$1 = TMPLIT_EXPR, DATA_ATTR$1 = DATA_ATTR, ARIA_ATTR$1 = ARIA_ATTR, IS_SCRIPT_OR_DATA$1 = IS_SCRIPT_OR_DATA, ATTR_WHITESPACE$1 = ATTR_WHITESPACE, CUSTOM_ELEMENT$1 = CUSTOM_ELEMENT;
  let IS_ALLOWED_URI$1 = IS_ALLOWED_URI;
  let ALLOWED_TAGS = null;
  const DEFAULT_ALLOWED_TAGS = addToSet({}, [
    ...html$1,
    ...svg$1,
    ...svgFilters,
    ...mathMl$1,
    ...text2
  ]);
  let ALLOWED_ATTR = null;
  const DEFAULT_ALLOWED_ATTR = addToSet({}, [
    ...html,
    ...svg,
    ...mathMl,
    ...xml
  ]);
  let CUSTOM_ELEMENT_HANDLING = Object.seal(create(null, {
    tagNameCheck: {
      writable: true,
      configurable: false,
      enumerable: true,
      value: null
    },
    attributeNameCheck: {
      writable: true,
      configurable: false,
      enumerable: true,
      value: null
    },
    allowCustomizedBuiltInElements: {
      writable: true,
      configurable: false,
      enumerable: true,
      value: false
    }
  }));
  let FORBID_TAGS2 = null;
  let FORBID_ATTR2 = null;
  const EXTRA_ELEMENT_HANDLING = Object.seal(create(null, {
    tagCheck: {
      writable: true,
      configurable: false,
      enumerable: true,
      value: null
    },
    attributeCheck: {
      writable: true,
      configurable: false,
      enumerable: true,
      value: null
    }
  }));
  let ALLOW_ARIA_ATTR = true;
  let ALLOW_DATA_ATTR = true;
  let ALLOW_UNKNOWN_PROTOCOLS = false;
  let ALLOW_SELF_CLOSE_IN_ATTR = true;
  let SAFE_FOR_TEMPLATES = false;
  let SAFE_FOR_XML = true;
  let WHOLE_DOCUMENT = false;
  let SET_CONFIG = false;
  let SET_CONFIG_ALLOWED_TAGS = null;
  let SET_CONFIG_ALLOWED_ATTR = null;
  let FORCE_BODY = false;
  let RETURN_DOM = false;
  let RETURN_DOM_FRAGMENT = false;
  let RETURN_TRUSTED_TYPE = false;
  let SANITIZE_DOM = true;
  let SANITIZE_NAMED_PROPS = false;
  const SANITIZE_NAMED_PROPS_PREFIX = "user-content-";
  let KEEP_CONTENT = true;
  let IN_PLACE = false;
  let IN_PLACE_VISITED = null;
  let USE_PROFILES = {};
  let FORBID_CONTENTS = null;
  const DEFAULT_FORBID_CONTENTS = addToSet({}, [
    "annotation-xml",
    "audio",
    "colgroup",
    "desc",
    "foreignobject",
    "head",
    "iframe",
    "math",
    "mi",
    "mn",
    "mo",
    "ms",
    "mtext",
    "noembed",
    "noframes",
    "noscript",
    "plaintext",
    "script",
    "selectedcontent",
    "style",
    "svg",
    "template",
    "thead",
    "title",
    "video",
    "xmp"
  ]);
  let DATA_URI_TAGS = null;
  const DEFAULT_DATA_URI_TAGS = addToSet({}, [
    "audio",
    "video",
    "img",
    "source",
    "image",
    "track"
  ]);
  let URI_SAFE_ATTRIBUTES = null;
  const DEFAULT_URI_SAFE_ATTRIBUTES = addToSet({}, [
    "alt",
    "class",
    "for",
    "id",
    "label",
    "name",
    "pattern",
    "placeholder",
    "role",
    "summary",
    "title",
    "value",
    "style",
    "xmlns"
  ]);
  const MATHML_NAMESPACE = "http://www.w3.org/1998/Math/MathML";
  const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
  const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
  let NAMESPACE = HTML_NAMESPACE;
  let IS_EMPTY_INPUT = false;
  let ALLOWED_NAMESPACES = null;
  const DEFAULT_ALLOWED_NAMESPACES = addToSet({}, [
    MATHML_NAMESPACE,
    SVG_NAMESPACE,
    HTML_NAMESPACE
  ], stringToString);
  const DEFAULT_MATHML_TEXT_INTEGRATION_POINTS = freeze([
    "mi",
    "mo",
    "mn",
    "ms",
    "mtext"
  ]);
  let MATHML_TEXT_INTEGRATION_POINTS = addToSet({}, DEFAULT_MATHML_TEXT_INTEGRATION_POINTS);
  const DEFAULT_HTML_INTEGRATION_POINTS = freeze(["annotation-xml"]);
  let HTML_INTEGRATION_POINTS = addToSet({}, DEFAULT_HTML_INTEGRATION_POINTS);
  const COMMON_SVG_AND_HTML_ELEMENTS = addToSet({}, [
    "title",
    "style",
    "font",
    "a",
    "script"
  ]);
  let PARSER_MEDIA_TYPE = null;
  const SUPPORTED_PARSER_MEDIA_TYPES = ["application/xhtml+xml", "text/html"];
  const DEFAULT_PARSER_MEDIA_TYPE = "text/html";
  let transformCaseFunc = null;
  let CONFIG = null;
  const formElement = document2.createElement("form");
  const isRegexOrFunction = function isRegexOrFunction2(testValue) {
    return testValue instanceof RegExp || testValue instanceof Function;
  };
  const _parseConfig = function _parseConfig2() {
    let cfg = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : {};
    if (CONFIG && CONFIG === cfg) return;
    if (!cfg || typeof cfg !== "object") cfg = {};
    cfg = clone(cfg);
    PARSER_MEDIA_TYPE = SUPPORTED_PARSER_MEDIA_TYPES.indexOf(cfg.PARSER_MEDIA_TYPE) === -1 ? DEFAULT_PARSER_MEDIA_TYPE : cfg.PARSER_MEDIA_TYPE;
    transformCaseFunc = PARSER_MEDIA_TYPE === "application/xhtml+xml" ? stringToString : stringToLowerCase;
    ALLOWED_TAGS = _resolveSetOption(cfg, "ALLOWED_TAGS", DEFAULT_ALLOWED_TAGS, { transform: transformCaseFunc });
    ALLOWED_ATTR = _resolveSetOption(cfg, "ALLOWED_ATTR", DEFAULT_ALLOWED_ATTR, { transform: transformCaseFunc });
    ALLOWED_NAMESPACES = _resolveSetOption(cfg, "ALLOWED_NAMESPACES", DEFAULT_ALLOWED_NAMESPACES, { transform: stringToString });
    URI_SAFE_ATTRIBUTES = _resolveSetOption(cfg, "ADD_URI_SAFE_ATTR", DEFAULT_URI_SAFE_ATTRIBUTES, {
      transform: transformCaseFunc,
      base: DEFAULT_URI_SAFE_ATTRIBUTES
    });
    DATA_URI_TAGS = _resolveSetOption(cfg, "ADD_DATA_URI_TAGS", DEFAULT_DATA_URI_TAGS, {
      transform: transformCaseFunc,
      base: DEFAULT_DATA_URI_TAGS
    });
    FORBID_CONTENTS = _resolveSetOption(cfg, "FORBID_CONTENTS", DEFAULT_FORBID_CONTENTS, { transform: transformCaseFunc });
    FORBID_TAGS2 = _resolveSetOption(cfg, "FORBID_TAGS", clone({}), { transform: transformCaseFunc });
    FORBID_ATTR2 = _resolveSetOption(cfg, "FORBID_ATTR", clone({}), { transform: transformCaseFunc });
    USE_PROFILES = objectHasOwnProperty(cfg, "USE_PROFILES") ? cfg.USE_PROFILES && typeof cfg.USE_PROFILES === "object" ? clone(cfg.USE_PROFILES) : cfg.USE_PROFILES : false;
    ALLOW_ARIA_ATTR = cfg.ALLOW_ARIA_ATTR !== false;
    ALLOW_DATA_ATTR = cfg.ALLOW_DATA_ATTR !== false;
    ALLOW_UNKNOWN_PROTOCOLS = cfg.ALLOW_UNKNOWN_PROTOCOLS || false;
    ALLOW_SELF_CLOSE_IN_ATTR = cfg.ALLOW_SELF_CLOSE_IN_ATTR !== false;
    SAFE_FOR_TEMPLATES = cfg.SAFE_FOR_TEMPLATES || false;
    SAFE_FOR_XML = cfg.SAFE_FOR_XML !== false;
    WHOLE_DOCUMENT = cfg.WHOLE_DOCUMENT || false;
    RETURN_DOM = cfg.RETURN_DOM || false;
    RETURN_DOM_FRAGMENT = cfg.RETURN_DOM_FRAGMENT || false;
    RETURN_TRUSTED_TYPE = cfg.RETURN_TRUSTED_TYPE || false;
    FORCE_BODY = cfg.FORCE_BODY || false;
    SANITIZE_DOM = cfg.SANITIZE_DOM !== false;
    SANITIZE_NAMED_PROPS = cfg.SANITIZE_NAMED_PROPS || false;
    KEEP_CONTENT = cfg.KEEP_CONTENT !== false;
    IN_PLACE = cfg.IN_PLACE || false;
    IS_ALLOWED_URI$1 = isRegex(cfg.ALLOWED_URI_REGEXP) ? cfg.ALLOWED_URI_REGEXP : IS_ALLOWED_URI;
    NAMESPACE = typeof cfg.NAMESPACE === "string" ? cfg.NAMESPACE : HTML_NAMESPACE;
    MATHML_TEXT_INTEGRATION_POINTS = _resolveObjectOption(cfg, "MATHML_TEXT_INTEGRATION_POINTS", () => addToSet({}, DEFAULT_MATHML_TEXT_INTEGRATION_POINTS));
    HTML_INTEGRATION_POINTS = _resolveObjectOption(cfg, "HTML_INTEGRATION_POINTS", () => addToSet({}, DEFAULT_HTML_INTEGRATION_POINTS));
    const customElementHandling = _resolveObjectOption(cfg, "CUSTOM_ELEMENT_HANDLING", () => create(null));
    CUSTOM_ELEMENT_HANDLING = create(null);
    if (objectHasOwnProperty(customElementHandling, "tagNameCheck") && isRegexOrFunction(customElementHandling.tagNameCheck)) CUSTOM_ELEMENT_HANDLING.tagNameCheck = customElementHandling.tagNameCheck;
    if (objectHasOwnProperty(customElementHandling, "attributeNameCheck") && isRegexOrFunction(customElementHandling.attributeNameCheck)) CUSTOM_ELEMENT_HANDLING.attributeNameCheck = customElementHandling.attributeNameCheck;
    if (objectHasOwnProperty(customElementHandling, "allowCustomizedBuiltInElements") && typeof customElementHandling.allowCustomizedBuiltInElements === "boolean") CUSTOM_ELEMENT_HANDLING.allowCustomizedBuiltInElements = customElementHandling.allowCustomizedBuiltInElements;
    seal(CUSTOM_ELEMENT_HANDLING);
    if (SAFE_FOR_TEMPLATES) ALLOW_DATA_ATTR = false;
    if (RETURN_DOM_FRAGMENT) RETURN_DOM = true;
    if (USE_PROFILES) {
      ALLOWED_TAGS = addToSet({}, text2);
      ALLOWED_ATTR = create(null);
      if (USE_PROFILES.html === true) {
        addToSet(ALLOWED_TAGS, html$1);
        addToSet(ALLOWED_ATTR, html);
      }
      if (USE_PROFILES.svg === true) {
        addToSet(ALLOWED_TAGS, svg$1);
        addToSet(ALLOWED_ATTR, svg);
        addToSet(ALLOWED_ATTR, xml);
      }
      if (USE_PROFILES.svgFilters === true) {
        addToSet(ALLOWED_TAGS, svgFilters);
        addToSet(ALLOWED_ATTR, svg);
        addToSet(ALLOWED_ATTR, xml);
      }
      if (USE_PROFILES.mathMl === true) {
        addToSet(ALLOWED_TAGS, mathMl$1);
        addToSet(ALLOWED_ATTR, mathMl);
        addToSet(ALLOWED_ATTR, xml);
      }
    }
    EXTRA_ELEMENT_HANDLING.tagCheck = null;
    EXTRA_ELEMENT_HANDLING.attributeCheck = null;
    if (objectHasOwnProperty(cfg, "ADD_TAGS")) {
      if (typeof cfg.ADD_TAGS === "function") EXTRA_ELEMENT_HANDLING.tagCheck = cfg.ADD_TAGS;
      else if (arrayIsArray(cfg.ADD_TAGS)) {
        if (ALLOWED_TAGS === DEFAULT_ALLOWED_TAGS) ALLOWED_TAGS = clone(ALLOWED_TAGS);
        addToSet(ALLOWED_TAGS, cfg.ADD_TAGS, transformCaseFunc);
      }
    }
    if (objectHasOwnProperty(cfg, "ADD_ATTR")) {
      if (typeof cfg.ADD_ATTR === "function") EXTRA_ELEMENT_HANDLING.attributeCheck = cfg.ADD_ATTR;
      else if (arrayIsArray(cfg.ADD_ATTR)) {
        if (ALLOWED_ATTR === DEFAULT_ALLOWED_ATTR) ALLOWED_ATTR = clone(ALLOWED_ATTR);
        addToSet(ALLOWED_ATTR, cfg.ADD_ATTR, transformCaseFunc);
      }
    }
    if (objectHasOwnProperty(cfg, "ADD_FORBID_CONTENTS") && arrayIsArray(cfg.ADD_FORBID_CONTENTS)) {
      if (FORBID_CONTENTS === DEFAULT_FORBID_CONTENTS) FORBID_CONTENTS = clone(FORBID_CONTENTS);
      addToSet(FORBID_CONTENTS, cfg.ADD_FORBID_CONTENTS, transformCaseFunc);
    }
    if (KEEP_CONTENT) ALLOWED_TAGS["#text"] = true;
    if (WHOLE_DOCUMENT) addToSet(ALLOWED_TAGS, [
      "html",
      "head",
      "body"
    ]);
    if (ALLOWED_TAGS.table) {
      addToSet(ALLOWED_TAGS, ["tbody"]);
      delete FORBID_TAGS2.tbody;
    }
    if (cfg.TRUSTED_TYPES_POLICY) {
      if (typeof cfg.TRUSTED_TYPES_POLICY.createHTML !== "function") throw typeErrorCreate('TRUSTED_TYPES_POLICY configuration option must provide a "createHTML" hook.');
      if (typeof cfg.TRUSTED_TYPES_POLICY.createScriptURL !== "function") throw typeErrorCreate('TRUSTED_TYPES_POLICY configuration option must provide a "createScriptURL" hook.');
      const previousTrustedTypesPolicy = trustedTypesPolicy;
      trustedTypesPolicy = cfg.TRUSTED_TYPES_POLICY;
      try {
        emptyHTML = _createTrustedHTML("");
      } catch (error) {
        trustedTypesPolicy = previousTrustedTypesPolicy;
        throw error;
      }
    } else if (cfg.TRUSTED_TYPES_POLICY === null) {
      trustedTypesPolicy = void 0;
      emptyHTML = "";
    } else {
      if (trustedTypesPolicy === void 0) trustedTypesPolicy = _getDefaultTrustedTypesPolicy();
      if (trustedTypesPolicy && typeof emptyHTML === "string") emptyHTML = _createTrustedHTML("");
    }
    if (freeze) freeze(cfg);
    CONFIG = cfg;
  };
  const ALL_SVG_TAGS = addToSet({}, [
    ...svg$1,
    ...svgFilters,
    ...svgDisallowed
  ]);
  const ALL_MATHML_TAGS = addToSet({}, [...mathMl$1, ...mathMlDisallowed]);
  const _checkSvgNamespace = function _checkSvgNamespace2(tagName, parent, parentTagName) {
    if (parent.namespaceURI === HTML_NAMESPACE) return tagName === "svg";
    if (parent.namespaceURI === MATHML_NAMESPACE) return tagName === "svg" && (parentTagName === "annotation-xml" || MATHML_TEXT_INTEGRATION_POINTS[parentTagName]);
    return Boolean(ALL_SVG_TAGS[tagName]);
  };
  const _checkMathMlNamespace = function _checkMathMlNamespace2(tagName, parent, parentTagName) {
    if (parent.namespaceURI === HTML_NAMESPACE) return tagName === "math";
    if (parent.namespaceURI === SVG_NAMESPACE) return tagName === "math" && HTML_INTEGRATION_POINTS[parentTagName];
    return Boolean(ALL_MATHML_TAGS[tagName]);
  };
  const _checkHtmlNamespace = function _checkHtmlNamespace2(tagName, parent, parentTagName) {
    if (parent.namespaceURI === SVG_NAMESPACE && !HTML_INTEGRATION_POINTS[parentTagName]) return false;
    if (parent.namespaceURI === MATHML_NAMESPACE && !MATHML_TEXT_INTEGRATION_POINTS[parentTagName]) return false;
    return !ALL_MATHML_TAGS[tagName] && (COMMON_SVG_AND_HTML_ELEMENTS[tagName] || !ALL_SVG_TAGS[tagName]);
  };
  const _checkValidNamespace = function _checkValidNamespace2(element) {
    const elementNamespace = _readNamespaceURI(element);
    const tagName = stringToLowerCase(_readNodeName(element));
    const parentNode = getParentNode(element);
    let parent;
    let parentTagName;
    if (parentNode && _readNodeType(parentNode) === NODE_TYPE.element) {
      parent = { namespaceURI: _readNamespaceURI(parentNode) };
      parentTagName = stringToLowerCase(_readNodeName(parentNode));
    } else {
      parent = { namespaceURI: NAMESPACE };
      parentTagName = "template";
    }
    if (!ALLOWED_NAMESPACES[elementNamespace]) return false;
    if (elementNamespace === SVG_NAMESPACE) return _checkSvgNamespace(tagName, parent, parentTagName);
    if (elementNamespace === MATHML_NAMESPACE) return _checkMathMlNamespace(tagName, parent, parentTagName);
    if (elementNamespace === HTML_NAMESPACE) return _checkHtmlNamespace(tagName, parent, parentTagName);
    if (PARSER_MEDIA_TYPE === "application/xhtml+xml" && ALLOWED_NAMESPACES[elementNamespace]) return true;
    return false;
  };
  const _forceRemove = function _forceRemove2(node) {
    arrayPush(DOMPurify.removed, { element: node });
    try {
      getParentNode(node).removeChild(node);
    } catch (_2) {
      remove(node);
      if (!getParentNode(node)) throw typeErrorCreate("a node selected for removal could not be detached from its tree and cannot be safely returned; refusing to sanitize in place");
    }
  };
  const _stripAttributeNode = function _stripAttributeNode2(element, attribute, name) {
    try {
      removeAttributeNode(element, attribute);
    } catch (_2) {
      try {
        element.removeAttribute(name);
      } catch (_3) {
      }
    }
  };
  const _neutralizeRoot = function _neutralizeRoot2(root) {
    _neutralizeSubtree(root);
    const childNodes = getChildNodes(root);
    if (childNodes) arrayForEach(arraySlice(childNodes), (child) => {
      try {
        remove(child);
      } catch (_2) {
      }
    });
    const attributes = _readNodeType(root) === NODE_TYPE.element ? getAttributes(root) : null;
    if (attributes) for (let i2 = attributes.length - 1; i2 >= 0; --i2) {
      const attribute = attributes[i2];
      const name = attribute && attribute.name;
      if (typeof name === "string") _stripAttributeNode(root, attribute, name);
    }
  };
  const _removeAttribute = function _removeAttribute2(name, element, attr) {
    if (!attr) try {
      attr = element.getAttributeNode(name);
    } catch (_2) {
      attr = null;
    }
    arrayPush(DOMPurify.removed, {
      attribute: attr || null,
      from: element
    });
    try {
      if (attr) removeAttributeNode(element, attr);
      else element.removeAttribute(name);
    } catch (_2) {
      try {
        element.removeAttribute(name);
      } catch (_3) {
      }
    }
    if (name === "is") {
      if (RETURN_DOM || RETURN_DOM_FRAGMENT) try {
        _forceRemove(element);
      } catch (_2) {
      }
      else try {
        element.setAttribute(name, "");
      } catch (_2) {
      }
    }
  };
  const _stripDisallowedAttributes = function _stripDisallowedAttributes2(element) {
    const attributes = getAttributes(element);
    if (!attributes) return;
    for (let i2 = attributes.length - 1; i2 >= 0; --i2) {
      const attribute = attributes[i2];
      const name = attribute && attribute.name;
      if (typeof name !== "string" || ALLOWED_ATTR[transformCaseFunc(name)]) continue;
      _stripAttributeNode(element, attribute, name);
    }
  };
  const _walkTree = function _walkTree2(root, visit) {
    let intoShadow = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : false;
    const stack = [root];
    while (stack.length > 0) {
      const node = stack.pop();
      if (visit(node) === false) continue;
      if (intoShadow && _readNodeType(node) === NODE_TYPE.element) {
        const shadowRoot = getShadowRoot(node);
        if (_isDocumentFragment(shadowRoot)) stack.push(shadowRoot);
      }
      const childNodes = getChildNodes(node);
      if (childNodes) for (let i2 = childNodes.length - 1; i2 >= 0; --i2) stack.push(childNodes[i2]);
    }
  };
  const _neutralizeSubtree = function _neutralizeSubtree2(root) {
    _walkTree(root, (node) => {
      if (_readNodeType(node) === NODE_TYPE.element) _stripDisallowedAttributes(node);
    });
  };
  const _collectLiveNodes = function _collectLiveNodes2(root) {
    const nodes = [];
    _walkTree(root, (node) => {
      nodes.push(node);
    }, true);
    return nodes;
  };
  const _neutralizeEscapedElements = function _neutralizeEscapedElements2(root, before) {
    const reachable = setCreate();
    arrayForEach(_collectLiveNodes(root), (node) => {
      if (_readNodeType(node) === NODE_TYPE.element) setAdd(reachable, node);
    });
    arrayForEach(before, (node) => {
      if (_readNodeType(node) === NODE_TYPE.element && !setHas(reachable, node)) _stripDisallowedAttributes(node);
    });
  };
  const _neutralizeDiscarded = function _neutralizeDiscarded2(root, before) {
    let rootRemoved = false;
    arrayForEach(DOMPurify.removed, (entry) => {
      if (entry.element) {
        rootRemoved = rootRemoved || entry.element === root;
        _neutralizeSubtree(entry.element);
      }
    });
    _neutralizeEscapedElements(root, before);
    return rootRemoved;
  };
  const MAX_UNVISITED_ROUNDS = 8;
  const _sanitizeUnvisitedNodes = function _sanitizeUnvisitedNodes2(root, before) {
    const visited = IN_PLACE_VISITED;
    let original = null;
    const getOriginal = () => {
      if (!original) {
        original = setCreate();
        arrayForEach(before, (beforeNode) => {
          setAdd(original, beforeNode);
        });
      }
      return original;
    };
    for (let round = 0; ; round++) {
      const live = _collectLiveNodes(root);
      const containers = [root];
      let pending = false;
      arrayForEach(live, (node) => {
        if (_readNodeType(node) === NODE_TYPE.documentFragment) arrayPush(containers, node);
        else if (!pending && !setHas(visited, node)) pending = setHas(getOriginal(), node);
      });
      if (!pending) return;
      if (round >= MAX_UNVISITED_ROUNDS) throw typeErrorCreate("the tree kept changing during in-place sanitization; refusing to return it");
      arrayForEach(containers, (container, index) => {
        _sanitizeUnvisitedIn(container, index > 0, root, getOriginal());
      });
    }
  };
  const _sanitizeUnvisitedIn = function _sanitizeUnvisitedIn2(container, inShadow, root, original) {
    const iterator = _createNodeIterator(container);
    let node;
    while (node = iterator.nextNode()) {
      if (!setHas(original, node) || setHas(IN_PLACE_VISITED, node)) continue;
      if (inShadow) _executeHooks(hooks.uponSanitizeShadowNode, node, null);
      _sanitizeElements(node, root);
      _sanitizeAttributes(node, root);
      if (_isDocumentFragment(node.content)) _sanitizeShadowDOM2(node.content);
    }
  };
  const _markVisited = function _markVisited2(node) {
    if (IN_PLACE_VISITED) setAdd(IN_PLACE_VISITED, node);
  };
  const _isPatchLinkageAttribute = function _isPatchLinkageAttribute2(lcName, lcTag) {
    if (!SAFE_FOR_XML) return false;
    if (lcName === "patchsrc") return true;
    return lcName === "for" && lcTag !== "label" && lcTag !== "output";
  };
  const _neutralizePatchLinkage = function _neutralizePatchLinkage2(root) {
    if (!SAFE_FOR_XML) return;
    _walkTree(root, (node) => {
      const nodeType = _readNodeType(node);
      if (nodeType === NODE_TYPE.processingInstruction || nodeType === NODE_TYPE.comment && regExpTest(COMMENT_MARKUP_PROBE, node.data)) {
        try {
          remove(node);
        } catch (_2) {
        }
        return false;
      }
      if (nodeType === NODE_TYPE.element) {
        const element = node;
        const lcTag = transformCaseFunc(_readNodeName(node));
        try {
          if (element.hasAttribute && element.hasAttribute("patchsrc")) element.removeAttribute("patchsrc");
          if (element.hasAttribute && element.hasAttribute("for") && _isPatchLinkageAttribute("for", lcTag)) element.removeAttribute("for");
        } catch (_2) {
        }
      }
      return true;
    });
  };
  const _initDocument = function _initDocument2(dirty) {
    let doc = null;
    let leadingWhitespace = null;
    if (FORCE_BODY) dirty = "<remove></remove>" + dirty;
    else {
      const matches = stringMatch(dirty, /^[\r\n\t ]+/);
      leadingWhitespace = matches && matches[0];
    }
    if (PARSER_MEDIA_TYPE === "application/xhtml+xml" && NAMESPACE === HTML_NAMESPACE) dirty = '<html xmlns="http://www.w3.org/1999/xhtml"><head></head><body>' + dirty + "</body></html>";
    const dirtyPayload = trustedTypesPolicy ? _createTrustedHTML(dirty) : dirty;
    if (NAMESPACE === HTML_NAMESPACE) try {
      doc = new DOMParser2().parseFromString(dirtyPayload, PARSER_MEDIA_TYPE);
    } catch (_2) {
    }
    if (!doc || !doc.documentElement) {
      doc = implementation.createDocument(NAMESPACE, "template", null);
      try {
        doc.documentElement.innerHTML = IS_EMPTY_INPUT ? emptyHTML : dirtyPayload;
      } catch (_2) {
      }
    }
    const body = doc.body || doc.documentElement;
    if (dirty && leadingWhitespace) body.insertBefore(document2.createTextNode(leadingWhitespace), body.childNodes[0] || null);
    if (NAMESPACE === HTML_NAMESPACE) return getElementsByTagName.call(doc, WHOLE_DOCUMENT ? "html" : "body")[0];
    return WHOLE_DOCUMENT ? doc.documentElement : body;
  };
  const _createNodeIterator = function _createNodeIterator2(root) {
    const doc = getOwnerDocument ? getOwnerDocument(root) : root.ownerDocument;
    return createNodeIterator.call(doc || root, root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_COMMENT | NodeFilter.SHOW_TEXT | NodeFilter.SHOW_PROCESSING_INSTRUCTION | NodeFilter.SHOW_CDATA_SECTION, null);
  };
  const _stripTemplateExpressions = function _stripTemplateExpressions2(value) {
    value = stringReplace(value, MUSTACHE_EXPR$1, " ");
    value = stringReplace(value, ERB_EXPR$1, " ");
    value = stringReplace(value, TMPLIT_EXPR$1, " ");
    return value;
  };
  const _scrubTemplateExpressions2 = function _scrubTemplateExpressions(node) {
    var _node$querySelectorAl;
    _scrubOwnCharacterData(node);
    const templates = (_node$querySelectorAl = node.querySelectorAll) === null || _node$querySelectorAl === void 0 ? void 0 : _node$querySelectorAl.call(node, "template");
    if (templates) arrayForEach(templates, (tmpl) => {
      if (_isDocumentFragment(tmpl.content)) _scrubTemplateExpressions2(tmpl.content);
    });
  };
  const _scrubOwnCharacterData = function _scrubOwnCharacterData2(node) {
    node.normalize();
    const doc = getOwnerDocument ? getOwnerDocument(node) : node.ownerDocument;
    const walker = createNodeIterator.call(doc || node, node, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_COMMENT | NodeFilter.SHOW_CDATA_SECTION | NodeFilter.SHOW_PROCESSING_INSTRUCTION, null);
    let currentNode = walker.nextNode();
    while (currentNode) {
      currentNode.data = _stripTemplateExpressions(currentNode.data);
      currentNode = walker.nextNode();
    }
  };
  const _isClobbered = function _isClobbered2(element) {
    const realTagName = getNodeName ? getNodeName(element) : null;
    if (typeof realTagName !== "string") return false;
    if (transformCaseFunc(realTagName) !== "form") return false;
    return typeof element.nodeName !== "string" || typeof element.textContent !== "string" || typeof element.removeChild !== "function" || element.attributes !== getAttributes(element) || typeof element.removeAttribute !== "function" || typeof element.removeAttributeNode !== "function" || typeof element.getAttributeNode !== "function" || typeof element.setAttribute !== "function" || typeof element.namespaceURI !== "string" || typeof element.insertBefore !== "function" || typeof element.hasChildNodes !== "function" || element.nodeType !== getNodeType(element) || element.childNodes !== getChildNodes(element);
  };
  const _isDocumentFragment = function _isDocumentFragment2(value) {
    if (!getNodeType || typeof value !== "object" || value === null) return false;
    try {
      return getNodeType(value) === NODE_TYPE.documentFragment;
    } catch (_2) {
      return false;
    }
  };
  const _isNode = function _isNode2(value) {
    if (!getNodeType || typeof value !== "object" || value === null) return false;
    try {
      return typeof getNodeType(value) === "number";
    } catch (_2) {
      return false;
    }
  };
  function _executeHooks(hooks2, currentNode, data) {
    if (hooks2.length === 0) return;
    arrayForEach(hooks2, (hook) => {
      hook.call(DOMPurify, currentNode, data, CONFIG);
    });
  }
  const _isUnsafeNode = function _isUnsafeNode2(currentNode, tagName) {
    if (SAFE_FOR_XML && currentNode.hasChildNodes() && !_isNode(currentNode.firstElementChild) && regExpTest(ELEMENT_MARKUP_PROBE, currentNode.textContent) && regExpTest(ELEMENT_MARKUP_PROBE, currentNode.innerHTML)) return true;
    if (SAFE_FOR_XML && LITERAL_TEXT_ELEMENTS[tagName] && _readNodeType(currentNode) === NODE_TYPE.element && _readNamespaceURI(currentNode) === HTML_NAMESPACE && (_isNode(currentNode.firstElementChild) || typeof currentNode.textContent === "string" && regExpTest(ELEMENT_MARKUP_PROBE, currentNode.textContent))) return true;
    if (currentNode.nodeType === NODE_TYPE.processingInstruction) return true;
    if (SAFE_FOR_XML && currentNode.nodeType === NODE_TYPE.comment && regExpTest(COMMENT_MARKUP_PROBE, currentNode.data)) return true;
    return false;
  };
  const _matchesNameCheck = function _matchesNameCheck2(check, name) {
    if (check instanceof RegExp) return regExpTest(check, name);
    if (check instanceof Function) {
      for (var _len = arguments.length, args = new Array(_len > 2 ? _len - 2 : 0), _key = 2; _key < _len; _key++) args[_key - 2] = arguments[_key];
      return Boolean(check(name, ...args));
    }
    return false;
  };
  const _sanitizeDisallowedNode = function _sanitizeDisallowedNode2(currentNode, tagName, root) {
    if (!FORBID_TAGS2[tagName] && _isBasicCustomElement(tagName) && _matchesNameCheck(CUSTOM_ELEMENT_HANDLING.tagNameCheck, tagName)) return false;
    if (KEEP_CONTENT && !FORBID_CONTENTS[tagName] && !FORBID_CONTENTS[stringToLowerCase(tagName)]) {
      const parentNode = getParentNode(currentNode);
      const childNodes = getChildNodes(currentNode);
      if (childNodes && parentNode) {
        const childCount = childNodes.length;
        for (let i2 = childCount - 1; i2 >= 0; --i2) {
          const hoisted = currentNode === root ? cloneNode(childNodes[i2], true) : childNodes[i2];
          parentNode.insertBefore(hoisted, getNextSibling(currentNode));
        }
      }
    }
    _forceRemove(currentNode);
    return true;
  };
  const _forkSharedAllowlist = function _forkSharedAllowlist2(hookList, set, defaultSet, setConfigSet) {
    if (hookList.length === 0) return set;
    return set === defaultSet || set === setConfigSet ? clone(set) : set;
  };
  const _handleHookDetachedNode = function _handleHookDetachedNode2(currentNode, root) {
    if (currentNode === root || getParentNode(currentNode) !== null) return false;
    if (IN_PLACE) _neutralizeSubtree(currentNode);
    return true;
  };
  const _sanitizeElements = function _sanitizeElements2(currentNode, root) {
    _markVisited(currentNode);
    _executeHooks(hooks.beforeSanitizeElements, currentNode, null);
    if (_handleHookDetachedNode(currentNode, root)) return true;
    if (_isClobbered(currentNode)) {
      _forceRemove(currentNode);
      return true;
    }
    const tagName = transformCaseFunc(_readNodeName(currentNode));
    ALLOWED_TAGS = _forkSharedAllowlist(hooks.uponSanitizeElement, ALLOWED_TAGS, DEFAULT_ALLOWED_TAGS, SET_CONFIG_ALLOWED_TAGS);
    _executeHooks(hooks.uponSanitizeElement, currentNode, {
      tagName,
      allowedTags: ALLOWED_TAGS
    });
    if (_handleHookDetachedNode(currentNode, root)) return true;
    if (_isUnsafeNode(currentNode, tagName)) {
      _forceRemove(currentNode);
      return true;
    }
    if (FORBID_TAGS2[tagName] || !(EXTRA_ELEMENT_HANDLING.tagCheck instanceof Function && EXTRA_ELEMENT_HANDLING.tagCheck(tagName)) && !ALLOWED_TAGS[tagName]) {
      const removed = _sanitizeDisallowedNode(currentNode, tagName, root);
      if (removed === false) {
        _executeHooks(hooks.afterSanitizeElements, currentNode, null);
        if (_handleHookDetachedNode(currentNode, root)) return true;
      }
      return removed;
    }
    if (_readNodeType(currentNode) === NODE_TYPE.element && !_checkValidNamespace(currentNode)) {
      _forceRemove(currentNode);
      return true;
    }
    if ((tagName === "noscript" || tagName === "noembed" || tagName === "noframes") && regExpTest(FALLBACK_TAG_CLOSE, currentNode.innerHTML)) {
      _forceRemove(currentNode);
      return true;
    }
    if (SAFE_FOR_TEMPLATES && currentNode.nodeType === NODE_TYPE.text) {
      const content = _stripTemplateExpressions(currentNode.textContent);
      if (currentNode.textContent !== content) {
        arrayPush(DOMPurify.removed, { element: currentNode.cloneNode() });
        currentNode.textContent = content;
      }
    }
    _executeHooks(hooks.afterSanitizeElements, currentNode, null);
    return _handleHookDetachedNode(currentNode, root);
  };
  const _isValidAttribute = function _isValidAttribute2(lcTag, lcName, value) {
    if (FORBID_ATTR2[lcName]) return false;
    if (_isPatchLinkageAttribute(lcName, lcTag)) return false;
    if (SANITIZE_DOM && (lcName === "id" || lcName === "name") && (value in document2 || value in formElement)) return false;
    const nameIsPermitted = ALLOWED_ATTR[lcName] || EXTRA_ELEMENT_HANDLING.attributeCheck instanceof Function && EXTRA_ELEMENT_HANDLING.attributeCheck(lcName, lcTag);
    if (ALLOW_DATA_ATTR && regExpTest(DATA_ATTR$1, lcName)) return true;
    if (ALLOW_ARIA_ATTR && regExpTest(ARIA_ATTR$1, lcName)) return true;
    if (!nameIsPermitted) return _isBasicCustomElement(lcTag) && _matchesNameCheck(CUSTOM_ELEMENT_HANDLING.tagNameCheck, lcTag) && _matchesNameCheck(CUSTOM_ELEMENT_HANDLING.attributeNameCheck, lcName, lcTag) || lcName === "is" && CUSTOM_ELEMENT_HANDLING.allowCustomizedBuiltInElements && _matchesNameCheck(CUSTOM_ELEMENT_HANDLING.tagNameCheck, value);
    if (URI_SAFE_ATTRIBUTES[lcName]) return true;
    if (regExpTest(IS_ALLOWED_URI$1, stringReplace(value, ATTR_WHITESPACE$1, ""))) return true;
    if ((lcName === "src" || lcName === "xlink:href" || lcName === "href") && lcTag !== "script" && stringIndexOf(value, "data:") === 0 && DATA_URI_TAGS[lcTag]) return true;
    if (ALLOW_UNKNOWN_PROTOCOLS && !regExpTest(IS_SCRIPT_OR_DATA$1, stringReplace(value, ATTR_WHITESPACE$1, ""))) return true;
    return !value;
  };
  const RESERVED_CUSTOM_ELEMENT_NAMES = addToSet({}, [
    "annotation-xml",
    "color-profile",
    "font-face",
    "font-face-format",
    "font-face-name",
    "font-face-src",
    "font-face-uri",
    "missing-glyph"
  ]);
  const _isBasicCustomElement = function _isBasicCustomElement2(tagName) {
    return !RESERVED_CUSTOM_ELEMENT_NAMES[stringToLowerCase(tagName)] && regExpTest(CUSTOM_ELEMENT$1, tagName);
  };
  const _applyTrustedTypesToAttribute = function _applyTrustedTypesToAttribute2(lcTag, lcName, namespaceURI, value) {
    if (trustedTypesPolicy && typeof trustedTypes === "object" && typeof trustedTypes.getAttributeType === "function" && !namespaceURI) switch (trustedTypes.getAttributeType(lcTag, lcName)) {
      case "TrustedHTML":
        return _createTrustedHTML(value);
      case "TrustedScriptURL":
        return _createTrustedScriptURL(value);
    }
    return value;
  };
  const _setAttributeValue = function _setAttributeValue2(currentNode, name, namespaceURI, value) {
    try {
      if (namespaceURI) currentNode.setAttributeNS(namespaceURI, name, value);
      else currentNode.setAttribute(name, value);
      if (_isClobbered(currentNode)) {
        _forceRemove(currentNode);
        return false;
      }
      return true;
    } catch (_2) {
      _removeAttribute(name, currentNode);
      return false;
    }
  };
  const _isUnsafeAttributeValue = function _isUnsafeAttributeValue2(name, value) {
    if (SAFE_FOR_XML && regExpTest(/((--!?|])>)|<\/(style|script|title|xmp|textarea|noscript|iframe|noembed|noframes)/i, value)) return true;
    return stringToLowerCase(name) === "attributename" && stringMatch(value, "href") !== null;
  };
  const _sanitizeAttributes = function _sanitizeAttributes2(currentNode, root) {
    _executeHooks(hooks.beforeSanitizeAttributes, currentNode, null);
    if (_handleHookDetachedNode(currentNode, root)) return;
    const attributes = currentNode.attributes;
    if (!attributes || _isClobbered(currentNode)) return;
    ALLOWED_ATTR = _forkSharedAllowlist(hooks.uponSanitizeAttribute, ALLOWED_ATTR, DEFAULT_ALLOWED_ATTR, SET_CONFIG_ALLOWED_ATTR);
    const hookEvent = {
      attrName: "",
      attrValue: "",
      keepAttr: true,
      allowedAttributes: ALLOWED_ATTR,
      forceKeepAttr: void 0
    };
    let l2 = attributes.length;
    const lcTag = transformCaseFunc(currentNode.nodeName);
    while (l2--) {
      const attr = attributes[l2];
      const name = attr.name, namespaceURI = attr.namespaceURI, attrValue = attr.value;
      const lcName = transformCaseFunc(name);
      const initValue = attrValue;
      let value = name === "value" ? initValue : stringTrim(initValue);
      let recreatedNamedProp = false;
      hookEvent.attrName = lcName;
      hookEvent.attrValue = value;
      hookEvent.keepAttr = true;
      hookEvent.forceKeepAttr = void 0;
      _executeHooks(hooks.uponSanitizeAttribute, currentNode, hookEvent);
      value = hookEvent.attrValue;
      if (SANITIZE_NAMED_PROPS && (lcName === "id" || lcName === "name") && stringIndexOf(value, SANITIZE_NAMED_PROPS_PREFIX) !== 0) {
        _removeAttribute(name, currentNode, attr);
        value = SANITIZE_NAMED_PROPS_PREFIX + value;
        recreatedNamedProp = true;
      }
      if (_isUnsafeAttributeValue(name, value)) {
        _removeAttribute(name, currentNode, attr);
        continue;
      }
      if (hookEvent.forceKeepAttr) continue;
      if (!hookEvent.keepAttr) {
        _removeAttribute(name, currentNode, attr);
        continue;
      }
      if (!ALLOW_SELF_CLOSE_IN_ATTR && regExpTest(SELF_CLOSING_TAG, value)) {
        _removeAttribute(name, currentNode, attr);
        continue;
      }
      if (SAFE_FOR_TEMPLATES) value = _stripTemplateExpressions(value);
      if (!_isValidAttribute(lcTag, lcName, value)) {
        _removeAttribute(name, currentNode, attr);
        continue;
      }
      value = _applyTrustedTypesToAttribute(lcTag, lcName, namespaceURI, value);
      if (value !== initValue) {
        if (_setAttributeValue(currentNode, name, namespaceURI, value) && recreatedNamedProp) arrayPop(DOMPurify.removed);
      }
    }
    _executeHooks(hooks.afterSanitizeAttributes, currentNode, null);
    _handleHookDetachedNode(currentNode, root);
  };
  const _sanitizeShadowDOM2 = function _sanitizeShadowDOM(fragment) {
    let shadowNode = null;
    const shadowIterator = _createNodeIterator(fragment);
    _executeHooks(hooks.beforeSanitizeShadowDOM, fragment, null);
    while (shadowNode = shadowIterator.nextNode()) {
      _executeHooks(hooks.uponSanitizeShadowNode, shadowNode, null);
      _sanitizeElements(shadowNode, fragment);
      _sanitizeAttributes(shadowNode, fragment);
      if (_isDocumentFragment(shadowNode.content)) _sanitizeShadowDOM2(shadowNode.content);
      if (_readNodeType(shadowNode) === NODE_TYPE.element) {
        const innerSr = getShadowRoot(shadowNode);
        if (_isDocumentFragment(innerSr)) {
          _sanitizeAttachedShadowRoots(innerSr);
          _sanitizeShadowDOM2(innerSr);
        }
      }
    }
    if (SAFE_FOR_TEMPLATES) _scrubOwnCharacterData(fragment);
    _executeHooks(hooks.afterSanitizeShadowDOM, fragment, null);
  };
  const _sanitizeAttachedShadowRoots = function _sanitizeAttachedShadowRoots2(root) {
    const stack = [{
      node: root,
      shadow: null
    }];
    while (stack.length > 0) {
      const item = stack.pop();
      if (item.shadow) {
        _sanitizeShadowDOM2(item.shadow);
        continue;
      }
      const node = item.node;
      const isElement = _readNodeType(node) === NODE_TYPE.element;
      const childNodes = getChildNodes(node);
      if (childNodes) for (let i2 = childNodes.length - 1; i2 >= 0; --i2) stack.push({
        node: childNodes[i2],
        shadow: null
      });
      if (isElement) {
        const rootName = getNodeName ? getNodeName(node) : null;
        if (typeof rootName === "string" && transformCaseFunc(rootName) === "template") {
          const content = node.content;
          if (_isDocumentFragment(content)) stack.push({
            node: content,
            shadow: null
          });
        }
      }
      if (isElement) {
        const sr = getShadowRoot(node);
        if (_isDocumentFragment(sr)) stack.push({
          node: null,
          shadow: sr
        }, {
          node: sr,
          shadow: null
        });
      }
    }
  };
  DOMPurify.sanitize = function(dirty) {
    let cfg = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {};
    let body = null;
    let importedNode = null;
    let currentNode = null;
    let returnNode = null;
    IS_EMPTY_INPUT = !dirty;
    if (IS_EMPTY_INPUT) dirty = "<!-->";
    if (typeof dirty !== "string" && !_isNode(dirty)) {
      dirty = stringifyValue(dirty);
      if (typeof dirty !== "string") throw typeErrorCreate("dirty is not a string, aborting");
    }
    if (!DOMPurify.isSupported) return dirty;
    if (SET_CONFIG) {
      ALLOWED_TAGS = SET_CONFIG_ALLOWED_TAGS;
      ALLOWED_ATTR = SET_CONFIG_ALLOWED_ATTR;
    } else _parseConfig(cfg);
    if (hooks.uponSanitizeElement.length > 0 || hooks.uponSanitizeAttribute.length > 0) ALLOWED_TAGS = clone(ALLOWED_TAGS);
    if (hooks.uponSanitizeAttribute.length > 0) ALLOWED_ATTR = clone(ALLOWED_ATTR);
    DOMPurify.removed = [];
    const inPlace = IN_PLACE && typeof dirty !== "string" && _isNode(dirty);
    let inPlaceNodes = [];
    const outerVisited = IN_PLACE_VISITED;
    if (inPlace) {
      _neutralizePatchLinkage(dirty);
      const nn = _readNodeName(dirty);
      if (typeof nn === "string") {
        const tagName = transformCaseFunc(nn);
        if (!ALLOWED_TAGS[tagName] || FORBID_TAGS2[tagName]) {
          _neutralizeRoot(dirty);
          throw typeErrorCreate("root node is forbidden and cannot be sanitized in-place");
        }
      }
      if (_isClobbered(dirty)) {
        _neutralizeRoot(dirty);
        throw typeErrorCreate("root node is clobbered and cannot be sanitized in-place");
      }
      inPlaceNodes = _collectLiveNodes(dirty);
      IN_PLACE_VISITED = setCreate();
    } else if (_isNode(dirty)) {
      body = _initDocument("<!---->");
      importedNode = body.ownerDocument.importNode(dirty, true);
      if (importedNode.nodeType === NODE_TYPE.element && importedNode.nodeName === "BODY") body = importedNode;
      else if (importedNode.nodeName === "HTML") body = importedNode;
      else body.appendChild(importedNode);
      _sanitizeAttachedShadowRoots(body);
    } else {
      if (!RETURN_DOM && !SAFE_FOR_TEMPLATES && !WHOLE_DOCUMENT && dirty.indexOf("<") === -1) return trustedTypesPolicy && RETURN_TRUSTED_TYPE ? _createTrustedHTML(dirty) : dirty;
      body = _initDocument(dirty);
      if (!body) return RETURN_DOM ? null : RETURN_TRUSTED_TYPE ? emptyHTML : "";
    }
    if (body && FORCE_BODY) _forceRemove(body.firstChild);
    const walkRoot = inPlace ? dirty : body;
    try {
      if (inPlace) _sanitizeAttachedShadowRoots(dirty);
      const nodeIterator = _createNodeIterator(walkRoot);
      while (currentNode = nodeIterator.nextNode()) {
        _sanitizeElements(currentNode, walkRoot);
        _sanitizeAttributes(currentNode, walkRoot);
        if (_isDocumentFragment(currentNode.content)) _sanitizeShadowDOM2(currentNode.content);
      }
      if (inPlace) _sanitizeUnvisitedNodes(dirty, inPlaceNodes);
    } catch (error) {
      if (inPlace) {
        _neutralizeRoot(dirty);
        _neutralizeDiscarded(dirty, inPlaceNodes);
      }
      throw error;
    } finally {
      IN_PLACE_VISITED = outerVisited;
    }
    if (inPlace) {
      if (_neutralizeDiscarded(dirty, inPlaceNodes)) throw typeErrorCreate("a node selected for removal could not be safely returned; refusing to sanitize in place");
      if (SAFE_FOR_TEMPLATES) _scrubTemplateExpressions2(dirty);
      return dirty;
    }
    if (RETURN_DOM) {
      if (SAFE_FOR_TEMPLATES) _scrubTemplateExpressions2(body);
      if (RETURN_DOM_FRAGMENT) {
        returnNode = createDocumentFragment.call(body.ownerDocument);
        while (body.firstChild) returnNode.appendChild(body.firstChild);
      } else returnNode = body;
      if (ALLOWED_ATTR.shadowroot || ALLOWED_ATTR.shadowrootmode) returnNode = importNode.call(originalDocument, returnNode, true);
      return returnNode;
    }
    let serializedHTML = WHOLE_DOCUMENT ? body.outerHTML : body.innerHTML;
    if (WHOLE_DOCUMENT && ALLOWED_TAGS["!doctype"] && body.ownerDocument && body.ownerDocument.doctype && body.ownerDocument.doctype.name && regExpTest(DOCTYPE_NAME, body.ownerDocument.doctype.name)) serializedHTML = "<!DOCTYPE " + body.ownerDocument.doctype.name + ">\n" + serializedHTML;
    if (SAFE_FOR_TEMPLATES) serializedHTML = _stripTemplateExpressions(serializedHTML);
    return trustedTypesPolicy && RETURN_TRUSTED_TYPE ? _createTrustedHTML(serializedHTML) : serializedHTML;
  };
  DOMPurify.setConfig = function() {
    let cfg = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : {};
    _parseConfig(cfg);
    SET_CONFIG = true;
    SET_CONFIG_ALLOWED_TAGS = ALLOWED_TAGS;
    SET_CONFIG_ALLOWED_ATTR = ALLOWED_ATTR;
  };
  DOMPurify.clearConfig = function() {
    CONFIG = null;
    SET_CONFIG = false;
    SET_CONFIG_ALLOWED_TAGS = null;
    SET_CONFIG_ALLOWED_ATTR = null;
    trustedTypesPolicy = defaultTrustedTypesPolicy;
    emptyHTML = "";
  };
  DOMPurify.isValidAttribute = function(tag, attr, value) {
    if (!CONFIG) _parseConfig({});
    const lcTag = transformCaseFunc(tag);
    const lcName = transformCaseFunc(attr);
    if (typeof value === "string" && (_isUnsafeAttributeValue(attr, value) || !ALLOW_SELF_CLOSE_IN_ATTR && regExpTest(SELF_CLOSING_TAG, value))) return false;
    return _isValidAttribute(lcTag, lcName, value);
  };
  DOMPurify.addHook = function(entryPoint, hookFunction) {
    if (typeof hookFunction !== "function") return;
    if (!objectHasOwnProperty(hooks, entryPoint)) return;
    arrayPush(hooks[entryPoint], hookFunction);
  };
  DOMPurify.removeHook = function(entryPoint, hookFunction) {
    if (!objectHasOwnProperty(hooks, entryPoint)) return;
    if (hookFunction !== void 0) {
      const index = arrayLastIndexOf(hooks[entryPoint], hookFunction);
      return index === -1 ? void 0 : arraySplice(hooks[entryPoint], index, 1)[0];
    }
    return arrayPop(hooks[entryPoint]);
  };
  DOMPurify.removeHooks = function(entryPoint) {
    if (!objectHasOwnProperty(hooks, entryPoint)) return;
    hooks[entryPoint] = [];
  };
  DOMPurify.removeAllHooks = function() {
    hooks = _createHooksMap();
  };
  return DOMPurify;
}
var purify_default = createDOMPurify();

// client/sanitize.ts
var FORBID_TAGS = [
  "script",
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "link",
  "meta",
  "base",
  "form",
  "noscript"
];
var FORBID_ATTR = ["href", "xlink:href"];
var ALLOWED_URI_REGEXP = /^data:/i;
function sanitizeSlideHtml(html2) {
  return purify_default.sanitize(html2, {
    FORBID_TAGS: [...FORBID_TAGS],
    FORBID_ATTR: [...FORBID_ATTR],
    ALLOWED_URI_REGEXP
  });
}

// client/stage.ts
function mountStage(host) {
  const root = document.createElement("div");
  root.style.cssText = "position: absolute; inset: 0; overflow: hidden;";
  const frame = document.createElement("div");
  frame.style.cssText = `position: absolute; top: 0; left: 0; width: ${STAGE_WIDTH}px; height: ${STAGE_HEIGHT}px; transform-origin: 0 0;`;
  const iframe = document.createElement("iframe");
  iframe.setAttribute("sandbox", "allow-same-origin");
  iframe.style.cssText = "display: block; width: 100%; height: 100%; border: 0; background: #fff;";
  frame.append(iframe);
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position: absolute; inset: 0; width: 100%; height: 100%; touch-action: none; cursor: crosshair;";
  root.append(frame, canvas);
  host.append(root);
  let fit = fitStage(1, 1);
  let viewport = stageViewport(1, 1, 1);
  const layoutListeners = /* @__PURE__ */ new Set();
  const layout = () => {
    const rect = root.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    fit = fitStage(rect.width, rect.height);
    frame.style.transform = `translate(${fit.offsetX}px, ${fit.offsetY}px) scale(${fit.scale})`;
    const dpr = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
    viewport = stageViewport(rect.width, rect.height, dpr);
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    for (const listener of layoutListeners) listener();
  };
  const observer = new ResizeObserver(layout);
  observer.observe(root);
  layout();
  return {
    update: (slide, css) => {
      iframe.srcdoc = renderDocument({ html: sanitizeSlideHtml(slide.html) }, css);
    },
    getViewport: () => viewport,
    onLayout: (listener) => {
      layoutListeners.add(listener);
      return () => {
        layoutListeners.delete(listener);
      };
    },
    overflow: () => {
      const doc = iframe.contentDocument;
      if (doc === null || doc.readyState !== "complete") return void 0;
      const root2 = doc.querySelector(".sensei-slide");
      if (root2 === null) return void 0;
      return root2.scrollHeight > root2.clientHeight || root2.scrollWidth > root2.clientWidth;
    },
    canvas,
    dispose: () => {
      observer.disconnect();
      layoutListeners.clear();
      root.remove();
    }
  };
}

// client/panel.tsx
var import_jsx_runtime = require("react/jsx-runtime");
var ROOT = {
  display: "flex",
  // 侧栏的 panelBody 是 row 方向的 flex 容器，根节点得自己撑开宽高（终端同理）。
  flex: "1 1 auto",
  flexDirection: "column",
  height: "100%",
  minWidth: 0,
  minHeight: 0,
  background: "var(--dsw-alias-bg-base, #ffffff)",
  color: "var(--dsw-alias-label-primary, #1e1e1e)",
  font: "inherit"
};
var BAR = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "6px 8px",
  borderBottom: "1px solid var(--dsw-alias-border-l1, #e5e5e5)"
};
var BUTTON = {
  minWidth: 28,
  height: 26,
  padding: "0 8px",
  cursor: "pointer",
  border: "1px solid var(--dsw-alias-border-l2, #d0d0d0)",
  borderRadius: 6,
  background: "var(--dsw-alias-bg-layer-2, #f7f7f7)",
  color: "inherit",
  font: "inherit"
};
var POSITION = {
  fontVariantNumeric: "tabular-nums",
  whiteSpace: "nowrap"
};
var STAGE = {
  position: "relative",
  flex: "1 1 auto",
  minHeight: 0,
  overflow: "hidden",
  background: "var(--dsw-alias-bg-layer-2, #f2f2f2)"
};
var TOOLBAR = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: 4,
  padding: "6px 8px",
  borderTop: "1px solid var(--dsw-alias-border-l1, #e5e5e5)"
};
var TITLE = {
  marginLeft: "auto",
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  opacity: 0.75
};
var EMPTY = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  height: "100%",
  padding: 24,
  boxSizing: "border-box",
  textAlign: "center",
  color: "var(--dsw-alias-text-secondary, #666)",
  font: "inherit"
};
var EMPTY_TITLE = {
  fontSize: 15,
  fontWeight: 600,
  color: "var(--dsw-alias-text-primary, inherit)"
};
var STATUS = {
  padding: "4px 8px",
  borderTop: "1px solid var(--dsw-alias-border-l1, #e5e5e5)",
  opacity: 0.8
};
var ELEMENTS = {
  marginLeft: "auto",
  opacity: 0.7,
  whiteSpace: "nowrap"
};
var TOOLS = [
  { tool: "pen", glyph: "\u270E", key: "tool.pen" },
  { tool: "line", glyph: "\u2571", key: "tool.line" },
  { tool: "arrow", glyph: "\u2197", key: "tool.arrow" },
  { tool: "rect", glyph: "\u25AD", key: "tool.rect" },
  { tool: "circle", glyph: "\u25EF", key: "tool.circle" },
  { tool: "text", glyph: "T", key: "tool.text" }
];
var WIDTHS = [2, 4, 8];
function describe(error) {
  return error instanceof Error ? error.message : String(error);
}
function SenseiPanel({ t: t2, useDeck, show, draw, snapshot, exportDeck, setOverflowProbe }) {
  const view = useDeck((value) => value);
  const deck = view.deck;
  const [style, setStyle] = (0, import_react.useState)(DEFAULT_ANNOTATE_STYLE);
  const [status, setStatus] = (0, import_react.useState)("");
  const [pending, setPending] = (0, import_react.useState)(false);
  const host = (0, import_react.useRef)(null);
  const stage = (0, import_react.useRef)(null);
  const annotator = (0, import_react.useRef)(null);
  const pages = deck.slides.length;
  const slide = deck.slides[deck.current];
  const hasSlide = slide !== void 0;
  const scene = deck.annotations[deck.current] ?? createScene();
  const handled = (0, import_react.useRef)({ snapshot: "", export: "" });
  const actions = (0, import_react.useRef)({ snapshot, exportDeck });
  const live = (0, import_react.useRef)({ slide: deck.current, stage });
  (0, import_react.useEffect)(() => {
    actions.current = { snapshot, exportDeck };
    live.current = { slide: deck.current, stage };
  });
  (0, import_react.useEffect)(() => {
    setOverflowProbe(() => {
      const mounted = live.current.stage.current;
      if (mounted === null) return void 0;
      const overflow = mounted.overflow();
      if (overflow === void 0) return void 0;
      const measurement = { slide: live.current.slide, overflow };
      return measurement;
    });
    return () => {
      setOverflowProbe(void 0);
    };
  }, [setOverflowProbe]);
  (0, import_react.useEffect)(() => {
    const request = view.snapshotRequest;
    if (request === null || handled.current.snapshot === request.id) return;
    handled.current.snapshot = request.id;
    void actions.current.snapshot(request).then(
      () => void 0,
      (error) => {
        setStatus(t2("status.failed", { reason: describe(error) }));
      }
    );
  }, [view.snapshotRequest, t2]);
  (0, import_react.useEffect)(() => {
    const request = view.exportRequest;
    if (request === null || handled.current.export === request.id) return;
    handled.current.export = request.id;
    setStatus(t2("status.exporting"));
    void actions.current.exportDeck(request).then(
      () => {
        setStatus("");
      },
      (error) => {
        setStatus(t2("status.failed", { reason: describe(error) }));
      }
    );
  }, [view.exportRequest, t2]);
  const submit = (commands) => {
    setStatus("");
    void draw(commands, deck.current).then(
      () => void 0,
      (error) => {
        setStatus(t2("status.failed", { reason: describe(error) }));
      }
    );
  };
  const latest = (0, import_react.useRef)({
    style,
    submit,
    prompt: t2("tool.textPrompt")
  });
  (0, import_react.useEffect)(() => {
    latest.current = { style, submit, prompt: t2("tool.textPrompt") };
  });
  (0, import_react.useEffect)(() => {
    const container = host.current;
    if (!hasSlide || container === null) return void 0;
    const stageHandle = mountStage(container);
    stage.current = stageHandle;
    const annotateHandle = mountAnnotator({
      canvas: stageHandle.canvas,
      viewport: stageHandle.getViewport,
      onLayout: stageHandle.onLayout,
      style: () => latest.current.style,
      askText: () => window.prompt(latest.current.prompt),
      onCommand: (command) => {
        latest.current.submit([command]);
      }
    });
    annotator.current = annotateHandle;
    return () => {
      annotator.current = null;
      annotateHandle.dispose();
      stage.current = null;
      stageHandle.dispose();
    };
  }, [hasSlide]);
  (0, import_react.useEffect)(() => {
    if (slide === void 0) return;
    stage.current?.update(slide, deck.css);
  }, [slide, deck.css]);
  (0, import_react.useEffect)(() => {
    annotator.current?.update(scene);
  }, [scene]);
  const go = (index) => {
    if (pending) return;
    setPending(true);
    setStatus("");
    void show(index).then(
      () => {
        setPending(false);
      },
      (error) => {
        setPending(false);
        setStatus(t2("status.failed", { reason: describe(error) }));
      }
    );
  };
  const undo = () => {
    const last = [...scene.elements].reverse().find((element) => !element.isDeleted);
    if (last === void 0) return;
    submit([{ op: "erase", ids: [last.id] }]);
  };
  if (pages === 0) {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: ROOT, role: "region", "aria-label": t2("view.sensei"), children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: EMPTY, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: EMPTY_TITLE, children: t2("panel.empty") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { children: t2("panel.emptyHint") })
    ] }) });
  }
  const elements = scene.elements.reduce((count, element) => element.isDeleted ? count : count + 1, 0);
  const note = status !== "" ? status : deck.lastExport === void 0 ? "" : t2("status.lastExport", { path: deck.lastExport });
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: ROOT, role: "region", "aria-label": t2("view.sensei"), children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: BAR, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "button",
        {
          type: "button",
          title: t2("nav.prev"),
          "aria-label": t2("nav.prev"),
          disabled: pending || deck.current <= 0,
          onClick: () => {
            go(deck.current - 1);
          },
          style: BUTTON,
          children: "\u2039"
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: POSITION, children: t2("nav.position", { current: deck.current + 1, pages }) }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "button",
        {
          type: "button",
          title: t2("nav.next"),
          "aria-label": t2("nav.next"),
          disabled: pending || deck.current >= pages - 1,
          onClick: () => {
            go(deck.current + 1);
          },
          style: BUTTON,
          children: "\u203A"
        }
      ),
      slide?.title === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: TITLE, children: slide.title })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { ref: host, style: STAGE }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: TOOLBAR, children: [
      TOOLS.map((entry) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "button",
        {
          type: "button",
          title: t2(entry.key),
          "aria-pressed": style.tool === entry.tool,
          onClick: () => {
            setStyle({ ...style, tool: entry.tool });
          },
          style: BUTTON,
          children: entry.glyph
        },
        entry.tool
      )),
      PALETTE.map((color) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "button",
        {
          type: "button",
          title: t2("tool.color", { color }),
          "aria-label": t2("tool.color", { color }),
          "aria-pressed": style.color === color,
          onClick: () => {
            setStyle({ ...style, color });
          },
          style: { ...BUTTON, background: color, padding: 0 }
        },
        color
      )),
      WIDTHS.map((width) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "button",
        {
          type: "button",
          title: t2("tool.width", { width }),
          "aria-label": t2("tool.width", { width }),
          "aria-pressed": style.width === width,
          onClick: () => {
            setStyle({ ...style, width });
          },
          style: BUTTON,
          children: String(width)
        },
        width
      )),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", onClick: undo, style: BUTTON, children: t2("action.undo") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", onClick: () => {
        submit([{ op: "clear" }]);
      }, style: BUTTON, children: t2("action.clearPage") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: ELEMENTS, children: t2("status.elements", { count: elements }) })
    ] }),
    note === "" ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: STATUS, children: note })
  ] });
}

// core/export-svg.ts
function buildExportSvg(options) {
  const width = STAGE_WIDTH * options.scale;
  const height = STAGE_HEIGHT * options.scale;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${String(width)}" height="${String(height)}" viewBox="0 0 ${String(STAGE_WIDTH)} ${String(STAGE_HEIGHT)}"><foreignObject x="0" y="0" width="${String(STAGE_WIDTH)}" height="${String(STAGE_HEIGHT)}"><div xmlns="http://www.w3.org/1999/xhtml" style="width:${String(STAGE_WIDTH)}px;height:${String(STAGE_HEIGHT)}px;overflow:hidden"><meta http-equiv="Content-Security-Policy" content="${escapeXml(SLIDE_CSP)}"/><style>${escapeXml(`${BASE_CSS}${options.css}`)}</style>` + options.body + "</div></foreignObject></svg>";
}
function escapeXml(text3) {
  return text3.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// client/rasterize.ts
var OFFSCREEN = `position: fixed; left: -10000px; top: 0; width: ${STAGE_WIDTH}px; height: ${STAGE_HEIGHT}px; border: 0; visibility: hidden;`;
async function openSlideDocument(html2, css) {
  const frame = document.createElement("iframe");
  frame.setAttribute("sandbox", "allow-same-origin");
  frame.style.cssText = OFFSCREEN;
  const loaded = new Promise((resolve, reject) => {
    frame.addEventListener("load", () => {
      resolve();
    }, { once: true });
    frame.addEventListener("error", () => {
      reject(new Error("sensei: the offscreen slide document failed to load"));
    }, { once: true });
  });
  frame.srcdoc = renderDocument({ html: sanitizeSlideHtml(html2) }, css);
  document.body.append(frame);
  await loaded;
  const doc = frame.contentDocument;
  if (doc === null) throw new Error("sensei: the offscreen slide document is not same-origin");
  await doc.fonts.ready;
  return { doc, dispose: () => {
    frame.remove();
  } };
}
async function rasterizeSlide(options) {
  const svg2 = buildExportSvg({ body: serializeBody(options.doc), css: options.css, scale: options.scale });
  if (new DOMParser().parseFromString(svg2, "image/svg+xml").getElementsByTagName("parsererror").length > 0) {
    throw new Error("sensei: the export SVG is not well-formed XML");
  }
  const image = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg2)}`);
  const width = Math.round(STAGE_WIDTH * options.scale);
  const height = Math.round(STAGE_HEIGHT * options.scale);
  const canvas = options.doc.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = context2d2(canvas);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0, width, height);
  if (options.scene !== void 0) drawAnnotations(ctx, options.doc, options.scene, width, height, options.scale);
  return await toPng(canvas);
}
async function rasterizePage(html2, css, scale, scene) {
  const opened = await openSlideDocument(html2, css);
  try {
    return await rasterizeSlide({
      doc: opened.doc,
      css,
      scale,
      ...scene === void 0 ? {} : { scene }
    });
  } finally {
    opened.dispose();
  }
}
function serializeBody(doc) {
  const holder = doc.createElement("div");
  holder.innerHTML = doc.body.innerHTML;
  return new XMLSerializer().serializeToString(holder);
}
function drawAnnotations(target, doc, scene, width, height, scale) {
  const overlay = doc.createElement("canvas");
  overlay.width = width;
  overlay.height = height;
  render(context2d2(overlay), scene, { scale, offsetX: 0, offsetY: 0 });
  target.drawImage(overlay, 0, 0);
}
function context2d2(canvas) {
  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("sensei: the browser returned no 2D context");
  return ctx;
}
function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => {
      resolve(image);
    }, { once: true });
    image.addEventListener("error", () => {
      reject(new Error("sensei: the browser could not decode the slide image"));
    }, { once: true });
    image.src = url;
  });
}
function toPng(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob === null) reject(new Error("sensei: the canvas produced no PNG"));
      else resolve(blob);
    }, "image/png");
  });
}

// vendor/dsh-blackboard/shared/ops.ts
var ID_SUFFIX = /^e(\d+)$/;
function nextIdAfter(nextId, id) {
  const match = ID_SUFFIX.exec(id);
  const value = match === null ? Number.NaN : Number(match[1]);
  return Number.isSafeInteger(value) && value + 1 > nextId ? value + 1 : nextId;
}
function applyOps(scene, ops) {
  const elements = [...scene.elements];
  let nextId = scene.nextId;
  for (const op of ops) {
    switch (op.op) {
      case "add":
        elements.push(op.element);
        nextId = nextIdAfter(nextId, op.element.id);
        break;
      case "patch": {
        const index = elements.findIndex((element2) => element2.id === op.id);
        const element = elements[index];
        if (element === void 0) break;
        elements[index] = { ...element, isDeleted: op.isDeleted };
        break;
      }
      case "clear":
        elements.length = 0;
        break;
      default:
        assertNever(op);
    }
  }
  return { elements, nextId };
}

// core/deck.ts
function emptyDeck() {
  return { css: "", slides: [], current: 0, annotations: [] };
}
function foldDeck(deck, op) {
  switch (op.op) {
    case "deck":
      return rebuild(op);
    case "slide":
      return upsert(deck, op.index, op.slide);
    case "show": {
      const target = pageIndex(deck, op.index);
      return target === void 0 ? deck : { ...deck, current: target };
    }
    case "annotate": {
      const target = pageIndex(deck, op.slide);
      if (target === void 0) return deck;
      const annotations = [...deck.annotations];
      annotations[target] = applyOps(deck.annotations[target] ?? createScene(), op.ops);
      return { ...deck, annotations };
    }
    case "clear": {
      const target = pageIndex(deck, op.slide);
      if (target === void 0) return deck;
      const annotations = [...deck.annotations];
      annotations[target] = { elements: [], nextId: deck.annotations[target]?.nextId ?? 0 };
      return { ...deck, annotations };
    }
    case "exported":
      return { ...deck, lastExport: op.path };
    default:
      return assertNever(op);
  }
}
function rebuild(op) {
  return {
    css: op.css ?? "",
    slides: [...op.slides],
    current: 0,
    annotations: op.slides.map(() => createScene())
  };
}
function upsert(deck, index, slide) {
  if (!Number.isInteger(index) || index < 0 || index > deck.slides.length) return deck;
  const slides = [...deck.slides];
  const annotations = [...deck.annotations];
  if (index === slides.length) {
    slides.push(slide);
    annotations.push(createScene());
  } else {
    slides[index] = slide;
  }
  return { ...deck, slides, annotations };
}
function pageIndex(deck, index) {
  return Number.isInteger(index) && index >= 0 && index < deck.slides.length ? index : void 0;
}

// client/source.ts
function createDeckSource(options) {
  let deck = emptyDeck();
  let revision = 0;
  let snapshotRequest = null;
  let exportRequest = null;
  let view = { deck, snapshotRequest, exportRequest };
  let timer;
  let probe;
  let sending = Promise.resolve();
  const listeners = /* @__PURE__ */ new Set();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const publish = () => {
    if (view.deck === deck && view.snapshotRequest === snapshotRequest && view.exportRequest === exportRequest) return;
    view = { deck, snapshotRequest, exportRequest };
    notify();
  };
  const applyDelta = (delta, from) => {
    if (delta.revision < revision) return;
    if (delta.revision === revision) {
      if (from === "poll") {
        snapshotRequest = delta.snapshotRequest ?? null;
        exportRequest = delta.exportRequest ?? null;
        publish();
      }
      return;
    }
    const start = delta.revision - delta.ops.length;
    if (start > revision) {
      revision = 0;
      deck = emptyDeck();
      publish();
      void poll();
      return;
    }
    let next = deck;
    for (const op of delta.ops.slice(revision - start)) next = foldDeck(next, op);
    deck = next;
    revision = delta.revision;
    if (from === "poll") {
      snapshotRequest = delta.snapshotRequest ?? null;
      exportRequest = delta.exportRequest ?? null;
    }
    publish();
  };
  const poll = async () => {
    const measurement = probe?.();
    await options.load(revision, measurement).then((delta) => applyDelta(delta, "poll"), () => void 0);
  };
  const send = (request) => {
    const run = sending.then(async () => {
      applyDelta(await request(), "submit");
    });
    sending = run.then(() => void 0, () => void 0);
    return run;
  };
  const subscribe = (listener) => {
    listeners.add(listener);
    if (timer === void 0) {
      void poll();
      timer = setInterval(() => {
        void poll();
      }, options.pollMs);
    }
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0 && timer !== void 0) {
        clearInterval(timer);
        timer = void 0;
      }
    };
  };
  return {
    getSnapshot: () => view,
    subscribe,
    show: (index) => send(() => options.show(index)),
    draw: (commands, slide) => send(() => options.draw(commands, slide)),
    setOverflowProbe: (next) => {
      probe = next;
    }
  };
}

// client/index.tsx
var POLL_MS = 1e3;
var SNAPSHOT_SCALE = 1;
var MAX_EXPORT_BYTES = 64 * 1024 * 1024;
var TAB_ID = "dsh-sensei";
var inject = ["slots", "locale", "sidebarRightTabs"];
function apply3(ctx) {
  const sources = /* @__PURE__ */ new Map();
  const loadDeck = async (sessionId, since, measurement) => {
    const query = new URLSearchParams({ sessionId, since: String(since) });
    if (measurement !== void 0) {
      query.set("slide", String(measurement.slide));
      query.set("overflow", measurement.overflow ? "1" : "0");
    }
    const response = await fetch(`${STATE_PATH}?${query.toString()}`);
    if (!response.ok) throw new Error(`sensei: state read failed with ${response.status}`);
    return parseDeckDelta(await response.json());
  };
  const showSlide = async (sessionId, index) => {
    const body = { show: index };
    const response = await fetch(`${OPS_PATH}?sessionId=${encodeURIComponent(sessionId)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!response.ok) throw new Error(`sensei: show failed with ${response.status}`);
    return parseDeckDelta(await response.json());
  };
  const drawOnSlide = async (sessionId, commands, slide) => {
    const body = { commands, slide };
    const response = await fetch(`${OPS_PATH}?sessionId=${encodeURIComponent(sessionId)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!response.ok) throw new Error(`sensei: draw failed with ${response.status}`);
    return parseDeckDelta(await response.json());
  };
  const reportProgress = async (sessionId, requestId, rendered, total) => {
    const query = new URLSearchParams({
      sessionId,
      requestId,
      rendered: String(rendered),
      total: String(total)
    });
    try {
      await fetch(`${PROGRESS_PATH}?${query.toString()}`, { method: "POST" });
    } catch {
    }
  };
  const deliverSnapshot = async (sessionId, request, view) => {
    const slide = view.deck.slides[request.slide];
    if (slide === void 0) {
      throw new Error(`sensei: slide ${request.slide + 1} is no longer in the deck`);
    }
    const scene = view.deck.annotations[request.slide];
    const png = await rasterizePage(slide.html, view.deck.css, SNAPSHOT_SCALE, scene);
    const bytes = new Uint8Array(await png.arrayBuffer());
    const response = await fetch(
      `${SNAPSHOT_PATH}?sessionId=${encodeURIComponent(sessionId)}&requestId=${encodeURIComponent(request.id)}`,
      { method: "POST", headers: { "content-type": "application/octet-stream" }, body: bytes }
    );
    if (!response.ok) throw new Error(`sensei: snapshot upload failed with ${response.status}`);
  };
  const deliverExport = async (sessionId, request, view) => {
    const deck = view.deck;
    if (deck.slides.length !== request.pages) {
      throw new Error(
        `sensei: the deck changed during the export (${deck.slides.length} slide(s) now, ${request.pages} expected)`
      );
    }
    const pages = [];
    for (const [index, slide] of deck.slides.entries()) {
      try {
        const png = await rasterizePage(slide.html, deck.css, request.scale);
        pages.push({ index, png: await base64Of(png) });
      } catch {
        continue;
      } finally {
        void reportProgress(sessionId, request.id, index + 1, deck.slides.length);
      }
    }
    const bytes = estimateExportBytes(pages);
    if (bytes > MAX_EXPORT_BYTES) throw new Error(t2("status.exportTooLarge"));
    const response = await fetch(
      `${EXPORT_PATH}?sessionId=${encodeURIComponent(sessionId)}&requestId=${encodeURIComponent(request.id)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pages })
      }
    );
    if (!response.ok) throw new Error(`sensei: export upload failed with ${response.status}`);
  };
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), "sensei: dictionaries");
  const t2 = ctx.locale.bind(NS);
  const injected = (sessionId) => {
    const existing = sources.get(sessionId);
    const source = existing ?? createDeckSource({
      load: (since, measurement) => loadDeck(sessionId, since, measurement),
      show: (index) => showSlide(sessionId, index),
      draw: (commands, slide) => drawOnSlide(sessionId, commands, slide),
      pollMs: POLL_MS
    });
    if (existing === void 0) sources.set(sessionId, source);
    return {
      hooks: { deck: source },
      show: source.show,
      draw: source.draw,
      setOverflowProbe: source.setOverflowProbe,
      snapshot: (request) => deliverSnapshot(sessionId, request, source.getSnapshot()),
      exportDeck: (request) => deliverExport(sessionId, request, source.getSnapshot())
    };
  };
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: TAB_ID,
    kind: "sensei",
    title: () => t2("view.sensei"),
    guide: [{ id: "open", order: 20, title: () => t2("view.sensei"), description: () => t2("guide.description") }]
  }), "sensei: tab type");
  ctx.effect(() => ctx.slots.inject("sidebar.right.pane.tab", () => ctx.slots.register({
    name: "sidebar.right.pane.tab",
    key: TAB_ID,
    locale: NS,
    inject: injected
  }, SenseiPanel)), "sensei: pane body");
}
async function base64Of(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const chunk = 32768;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
}
/*! Bundled license information:

dompurify/dist/purify.es.mjs:
  (*! @license DOMPurify 3.4.17 | (c) Cure53 and other contributors | Released under the Apache license 2.0 and Mozilla Public License 2.0 | github.com/cure53/DOMPurify/blob/3.4.17/LICENSE *)
  (*! regenerator-runtime -- Copyright (c) 2014-present, Facebook, Inc. -- license (MIT): https://github.com/babel/babel/blob/main/packages/babel-helpers/LICENSE *)
*/

return module.exports; } });

