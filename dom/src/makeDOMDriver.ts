import {StreamAdapter} from '@cycle/base';
import {init as initSnabbdom, PatchFunction} from 'snabbdom';
import xs, {Stream} from 'xstream';
import {DOMSource} from './DOMSource';
import {MainDOMSource} from './MainDOMSource';
import {VNode} from './interfaces';
import {VNodeWrapper} from './VNodeWrapper';
import {getElement} from './utils';
import defaultModules from './modules';
import {IsolateModule} from './IsolateModule';
import {makeTransposeVNode} from './transposition';
import {EventDelegator} from './EventDelegator';
import xsAdapter from '@cycle/xstream-adapter';
let MapPolyfill: typeof Map = require('es6-map');

export {makeDOMDriver}

export interface DOMDriverOptions {
  modules?: Array<any>;
  transposition?: boolean;
}

function makeDOMDriver(
  container: string | Element,
  options: {transposition?: boolean, modules?: Array<any>} = {}
): Function {
  const {transposition = false, modules = defaultModules} = options;

  makeDOMDriverModulesGuard(modules);

  const isolateModule = new IsolateModule(new MapPolyfill<string, Element>());
  const eventDelegators: Map<string, EventDelegator> =
    new MapPolyfill<string, EventDelegator>();

  const patch: PatchFunction = initSnabbdom([isolateModule.createModule()]
                                 .concat(modules));

  const rootElement: Element = getElement(container);
  const vnodeWrapper = new VNodeWrapper(rootElement);

  function _DOMDriver(vNode$: Stream<VNode>,
                      runStreamAdapter: StreamAdapter,
                      driverKey: string): DOMSource {
    domDriverVNodeStreamGuard(vNode$);

    const transposeVNode: (vNode: VNode) => xs<VNode> =
      makeTransposeVNode(runStreamAdapter);
    const preprocessedVNode$: xs<VNode> = transposition
                                          ? vNode$.map(transposeVNode).flatten()
                                          : vNode$;

    const sanitation$: xs<any> = xs.create();
    const rootElement$: xs<Element> =
      xs.merge(preprocessedVNode$.endWhen(sanitation$), sanitation$)
        .map(vnode => vnodeWrapper.call(vnode))
        .fold<VNode>(<(acc: VNode, vNode: VNode) => VNode>patch, <VNode> rootElement)
        .drop(1)
        .map(function extractElement(vNode: VNode) { return vNode.elm; })
        // @TODO We need a test for the necessity of incomplete stream.
        .compose(stream => xs.merge(stream, xs.never()))
        .startWith(rootElement);

    rootElement$.addListener({next: noop, error: noop, complete: noop});

    return new MainDOMSource({
      runStreamAdapter,
      driverKey,
      namespace: [],
      rootElement$,
      sanitation$,
      isolateModule,
      eventDelegators
    });
  }

  (<any>_DOMDriver).streamAdapter = xsAdapter;

  return _DOMDriver;
}

function noop(): void {}

function makeDOMDriverModulesGuard(modules: Array<any>) {
  if (!Array.isArray(modules)) {
    throw new Error(`Optional modules option must be ` +
     `an array for snabbdom modules`);
  }
}

function domDriverVNodeStreamGuard(vnode$: Stream<VNode>): void {
  if (!vnode$
    || typeof vnode$.addListener !== `function`
    || typeof vnode$.fold !== `function`) {
    throw new Error(`The DOM driver function expects as input a Stream of ` +
      `virtual DOM elements`);
  }
}
