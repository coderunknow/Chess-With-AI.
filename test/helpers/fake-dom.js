/**
 * Minimal DOM double for testing the side panel without a browser.
 *
 * It implements exactly the surface the UI modules use (class lists, dataset,
 * attributes, listeners, children) so orchestration bugs surface in Node. It is
 * deliberately not a general-purpose DOM.
 *
 * @module test/helpers/fake-dom
 */

class FakeClassList {
  #names = new Set();

  /**
   * @param {string} className
   */
  add(...classNames) {
    for (const name of classNames) {
      this.#names.add(name);
    }
  }

  /**
   * @param {string} className
   */
  remove(...classNames) {
    for (const name of classNames) {
      this.#names.delete(name);
    }
  }

  /**
   * @param {string} className
   * @returns {boolean}
   */
  contains(className) {
    return this.#names.has(className);
  }

  /**
   * @param {string} className
   * @param {boolean} [force]
   * @returns {boolean} the resulting state.
   */
  toggle(className, force) {
    const shouldAdd = force === undefined ? !this.contains(className) : Boolean(force);
    if (shouldAdd) {
      this.add(className);
    } else {
      this.remove(className);
    }
    return shouldAdd;
  }

  /**
   * Replaces the class list from a `className` string.
   *
   * @param {string} value
   */
  set value(value) {
    this.#names = new Set(String(value).split(/\s+/).filter(Boolean));
  }

  /** @returns {string} */
  get value() {
    return [...this.#names].join(" ");
  }
}

export class FakeElement {
  /**
   * @param {string} [tagName]
   * @param {object} [options]
   * @param {string[]} [options.selectors] CSS selectors this element matches.
   * @param {string} [options.text] initial text content.
   * @param {boolean} [options.editable] marks the element as a contenteditable editor.
   * @param {boolean} [options.visible] `false` makes every measurement zero-sized.
   */
  constructor(tagName = "div", { selectors = [], text = "", editable = false, visible = true } = {}) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.style = {};
    this.classList = new FakeClassList();
    this.listeners = new Map();
    this.textContent = text;
    this.value = "";
    this.hidden = false;
    this.disabled = false;
    this.open = false;
    this.parentElement = null;
    this.isConnected = true;
    this.selectorMatches = selectors;
    this.isContentEditable = editable;
    this.visible = visible;
    this.dispatched = [];
  }

  /**
   * @param {string} selector
   * @returns {boolean} true when the element was registered for `selector`.
   */
  matches(selector) {
    return this.selectorMatches.includes(selector);
  }

  /** @returns {string} */
  get className() {
    return this.classList.value;
  }

  /** @param {string} value */
  set className(value) {
    this.classList.value = value;
  }

  /** @returns {FakeElement|null} */
  get firstElementChild() {
    return this.children[0] || null;
  }

  /**
   * @param {string} type
   * @param {Function} handler
   */
  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) || [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }

  /**
   * @param {string} type
   * @param {Function} handler
   */
  removeEventListener(type, handler) {
    const handlers = (this.listeners.get(type) || []).filter((entry) => entry !== handler);
    this.listeners.set(type, handlers);
  }

  /**
   * @param {string} type
   * @param {object} [event]
   * @returns {boolean} whether any handler called preventDefault.
   */
  dispatch(type, event = {}) {
    let prevented = false;
    const payload = {
      type,
      target: this,
      preventDefault: () => {
        prevented = true;
      },
      ...event,
    };
    this.dispatched.push({ type, ...payload });
    for (const handler of this.listeners.get(type) || []) {
      handler(payload);
    }
    return prevented;
  }

  /** Clicks the element, as a user would. */
  click() {
    this.dispatch("click", { target: this });
  }

  /** @param {object} event */
  dispatchEvent(event) {
    this.dispatched.push(event);
    for (const handler of this.listeners.get(event.type) || []) {
      handler(event);
    }
    return true;
  }

  /**
   * @param {...FakeElement} nodes
   */
  append(...nodes) {
    for (const node of nodes) {
      if (node && typeof node === "object") {
        node.parentElement = this;
        node.ownerDocument = this.ownerDocument;
      }
      this.children.push(node);
    }
  }

  /**
   * @param {string} id
   * @returns {FakeElement|null} the first descendant element with that id.
   */
  findById(id) {
    if (this.id === id) {
      return this;
    }
    for (const child of this.children) {
      if (child instanceof FakeElement) {
        const found = child.findById(id);
        if (found) {
          return found;
        }
      }
    }
    return null;
  }

  /**
   * Removes the element from its parent.
   *
   * @returns {void}
   */
  remove() {
    if (this.parentElement) {
      this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
      this.parentElement = null;
    }
    this.isConnected = false;
  }

  /**
   * @param {...FakeElement} nodes
   */
  replaceChildren(...nodes) {
    this.children = [];
    if (nodes.length === 1 && nodes[0]?.isFragment) {
      this.append(...nodes[0].children);
      return;
    }
    this.append(...nodes);
  }

  /** Removes every child that matches a class name. */
  clearChildrenByClass(className) {
    this.children = this.children.filter((child) => !child.classList?.contains(className));
  }

  /**
   * @param {string} selector comma separated CSS selectors.
   * @returns {FakeElement|null} the first registered match in this subtree.
   */
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  /**
   * Selector support is registry based: an element matches when it was
   * registered with that exact selector string.
   *
   * @param {string} selector comma separated CSS selectors.
   * @returns {FakeElement[]} matching elements, in tree order.
   */
  querySelectorAll(selector) {
    const selectors = selector.split(",").map((entry) => entry.trim());
    const registry = this.ownerDocument?.registry || [];
    const matches = registry.filter((element) => selectors.some((entry) => element.matches(entry)));

    if (this === this.ownerDocument) {
      return matches;
    }
    return matches.filter((element) => isDescendantOf(element, this));
  }

  /**
   * @param {string} name
   * @param {string} value
   */
  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  /**
   * @param {string} name
   * @returns {boolean}
   */
  hasAttribute(name) {
    return Object.hasOwn(this.attributes, name) || this[name] === true;
  }

  /**
   * @param {string} name
   * @returns {string|null}
   */
  getAttribute(name) {
    return Object.hasOwn(this.attributes, name) ? this.attributes[name] : null;
  }

  /**
   * @param {string} name
   */
  removeAttribute(name) {
    delete this.attributes[name];
  }

  /**
   * Walks up the tree looking for the nearest element that matches, which also
   * covers the `[data-*]` selectors the UI uses.
   *
   * @param {string} selector comma separated CSS selectors.
   * @returns {FakeElement|null}
   */
  closest(selector) {
    const selectors = selector.split(",").map((entry) => entry.trim());
    let node = /** @type {FakeElement|null} */ (this);
    while (node) {
      for (const entry of selectors) {
        if (
          node.matches(entry) ||
          (entry === "[data-piece]" && node.dataset.piece) ||
          (entry === "[data-cancel]" && node.dataset.cancel !== undefined) ||
          (entry === "[data-square]" && node.dataset.square)
        ) {
          return node;
        }
      }
      node = node.parentElement;
    }
    return null;
  }

  /**
   * @param {FakeElement} element
   * @returns {boolean} true when `element` is inside this subtree.
   */
  contains(element) {
    let node = element.parentElement;
    while (node) {
      if (node === this) {
        return true;
      }
      node = node.parentElement;
    }
    return false;
  }

  /** @returns {object} */
  getBoundingClientRect() {
    if (!this.visible || !this.isConnected) {
      return { width: 0, height: 0, top: 0, bottom: 0, left: 0, right: 0 };
    }
    const height = this.tagName === "TEXTAREA" ? 40 : 20;
    const offset = this.verticalOffset || 0;
    return { width: 120, height, top: offset, bottom: offset + height, left: 0, right: 120 };
  }

  /** @returns {object} the computed style the visibility checks read. */
  getComputedStyle() {
    return { display: "block", visibility: "visible", opacity: "1" };
  }

  focus() {}

  blur() {}

  showModal() {
    this.open = true;
  }

  close() {
    this.open = false;
  }

  scrollIntoView() {}
}

/**
 * @param {FakeElement} element
 * @param {FakeElement} ancestor
 * @returns {boolean} true when `element` sits inside `ancestor`.
 */
function isDescendantOf(element, ancestor) {
  let node = element.parentElement;
  while (node) {
    if (node === ancestor) {
      return true;
    }
    node = node.parentElement;
  }
  return false;
}

/**
 * Creates a document stub whose element factory is `FakeElement`.
 *
 * Elements become queryable through `register()`, which records the CSS
 * selectors each element should match.
 *
 * @param {Record<string, FakeElement>} [elementsById]
 * @returns {object} the document double.
 */
export function createFakeDocument(elementsById = {}) {
  /** @type {FakeElement[]} */
  const registry = [];
  const body = new FakeElement("body");

  const document = {
    body,
    title: "Chess chat",
    registry,
    addEventListener: () => undefined,
    createElement: (tagName, options = {}) => {
      const lower = tagName.toLowerCase();
      const element =
        lower === "textarea"
          ? new FakeTextAreaElement(options)
          : lower === "input"
            ? new FakeInputElement(options)
            : new FakeElement(tagName, options);
      element.ownerDocument = document;
      return element;
    },
    createDocumentFragment: () => {
      const fragment = new FakeElement("fragment");
      fragment.isFragment = true;
      fragment.ownerDocument = document;
      return fragment;
    },
    getElementById: (id) => elementsById[id] || body.findById(id) || null,
    querySelector: (selector) => document.querySelectorAll(selector)[0] || null,
    querySelectorAll: (selector) =>
      document.registry.filter((element) => element.matches(selector)).map((element) => element),
    /**
     * @param {FakeElement} element
     * @param {string[]} selectors
     * @returns {FakeElement} the element, for chaining.
     */
    register(element, selectors = []) {
      element.selectorMatches = selectors;
      element.ownerDocument = document;
      if (!registry.includes(element)) {
        registry.push(element);
      }
      return element;
    },
  };

  body.ownerDocument = document;
  for (const element of Object.values(elementsById)) {
    element.ownerDocument = document;
  }
  return document;
}

/**
 * Installs the DOM doubles on `globalThis` for the duration of a test.
 *
 * @param {object} [options]
 * @param {Record<string, FakeElement>} [options.elementsById]
 * @returns {{document: object, restore: () => void}} handle to undo the install.
 */
export function installFakeDom({ elementsById = {} } = {}) {
  const previous = {
    document: globalThis.document,
    Element: globalThis.Element,
    window: globalThis.window,
    MutationObserver: globalThis.MutationObserver,
    getComputedStyle: globalThis.getComputedStyle,
    HTMLElement: globalThis.HTMLElement,
    HTMLTextAreaElement: globalThis.HTMLTextAreaElement,
    HTMLInputElement: globalThis.HTMLInputElement,
    Node: globalThis.Node,
    KeyboardEvent: globalThis.KeyboardEvent,
  };

  const document = createFakeDocument(elementsById);
  globalThis.document = /** @type {Document} */ (document);
  globalThis.Element = FakeElement;
  globalThis.window = /** @type {Window} */ ({
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
    location: { hostname: "chatgpt.com", href: "https://chatgpt.com/" },
    getComputedStyle: (element) => element.getComputedStyle(),
    getSelection: () => null,
    addEventListener: () => undefined,
  });
  globalThis.getComputedStyle = (element) => element.getComputedStyle();
  globalThis.MutationObserver = FakeMutationObserver;
  globalThis.HTMLElement = FakeElement;
  globalThis.HTMLTextAreaElement = FakeTextAreaElement;
  globalThis.HTMLInputElement = FakeInputElement;
  globalThis.Node = FakeElement;
  globalThis.KeyboardEvent =
    globalThis.KeyboardEvent ||
    class KeyboardEvent extends Event {
      /**
       * @param {string} type
       * @param {object} [init]
       */
      constructor(type, init = {}) {
        super(type, init);
        this.key = init.key || "";
        this.code = init.code || "";
        this.keyCode = init.keyCode || 0;
      }
    };
  globalThis.InputEvent =
    globalThis.InputEvent ||
    class InputEvent extends Event {
      /**
       * @param {string} type
       * @param {object} [init]
       */
      constructor(type, init = {}) {
        super(type, init);
        this.inputType = init.inputType || "";
        this.data = init.data ?? null;
      }
    };
  // `navigator` is a getter-only global in Node, so it must be redefined.
  const clipboard = {
    writeText: async (text) => {
      document.lastCopiedText = text;
    },
  };
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    value: { clipboard },
    configurable: true,
    writable: true,
  });

  return {
    document,
    MutationObserver: FakeMutationObserver,
    /**
     * @param {FakeElement} element
     * @param {string[]} selectors
     * @returns {FakeElement}
     */
    register: (element, selectors) => document.register(element, selectors),
    restore() {
      globalThis.document = previous.document;
      globalThis.Element = previous.Element;
      globalThis.window = previous.window;
      globalThis.MutationObserver = previous.MutationObserver;
      globalThis.getComputedStyle = previous.getComputedStyle;
      globalThis.HTMLElement = previous.HTMLElement;
      globalThis.HTMLTextAreaElement = previous.HTMLTextAreaElement;
      globalThis.HTMLInputElement = previous.HTMLInputElement;
      globalThis.Node = previous.Node;
      globalThis.KeyboardEvent = previous.KeyboardEvent;
      FakeMutationObserver.created.length = 0;
      if (navigatorDescriptor) {
        Object.defineProperty(globalThis, "navigator", navigatorDescriptor);
      } else {
        delete globalThis.navigator;
      }
    },
  };
}

/** Stand-in for `HTMLTextAreaElement` so `instanceof` checks behave. */
export class FakeTextAreaElement extends FakeElement {
  /** @param {object} [options] */
  constructor(options = {}) {
    super("textarea", options);
  }
}

/** Stand-in for `HTMLInputElement` so `instanceof` checks behave. */
export class FakeInputElement extends FakeElement {
  /** @param {object} [options] */
  constructor(options = {}) {
    super("input", options);
  }
}

/**
 * MutationObserver double: records the callback and lets a test replay
 * mutation records against it.
 */
export class FakeMutationObserver {
  /** @type {FakeMutationObserver[]} every instance, newest last. */
  static created = [];

  /** @param {(records: object[], observer: FakeMutationObserver) => void} callback */
  constructor(callback) {
    this.callback = callback;
    this.observations = [];
    this.disconnected = false;
    FakeMutationObserver.created.push(this);
  }

  /** @returns {FakeMutationObserver[]} instances created since the last reset. */
  static takeAll() {
    const instances = [...FakeMutationObserver.created];
    FakeMutationObserver.created.length = 0;
    return instances;
  }

  /**
   * @param {object} target
   * @param {object} options
   */
  observe(target, options) {
    this.target = target;
    this.options = options;
    this.disconnected = false;
    this.observations.push({ target, options });
  }

  disconnect() {
    this.disconnected = true;
  }

  /**
   * Simulates a batch of mutations.
   *
   * @param {object[]} records
   */
  trigger(records) {
    if (!this.disconnected) {
      this.callback(records, this);
    }
  }

  takeRecords() {
    return [];
  }
}
