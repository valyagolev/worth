import { promises as fs } from "fs";

type Command = string | { pushValue: Value } | { marker: any };
type Value = any;
type Stack = Value[];

function parse(v: string): Command[] {
  return v.split(/\s+/).filter((s) => s);
}

function collectBrackets(stack: Stack, open: string, close: string): Value[] {
  let k,
    depth = 1,
    res: Value[] = [];
  while (true) {
    k = stack.pop();
    if (k === undefined) throw "unmatched " + open;
    else if (k === close) {
      depth--;
      if (depth == 0) return res;
    } else if (k === open) depth++;

    res.push(k);
  }
}

const stdLib = `

: if       ( b bl - )    [ ] choose ;

: while    ( bl - )      dup [ call ] dip swap [ while ] [ drop ] choose ;
: forever  ( bl - )      dup [ call ] dip forever ;
: loop     ( mk bl - )   swap [ forever ] escapable ;
: time     ( bl - )      now! [ call ] dip now! swap - #:profile_result: print print ;

: divides? ( n n - b )   mod #0 eq? ;
#'divides? compile



`;

function expectString(cmd: Command) {
  if (typeof cmd !== "string") throw "Bad string";
  return cmd;
}

function compile(commands: Command[]): (stack: Stack) => void {
  // console.log(compile, commands);

  const result = symbolically(commands);

  // console.log("compiled", JSON.stringify(result, null, 4));

  let fncnt = 0;
  let fnsI: { [k: string]: number } = {};
  let fns: any = {};

  const compileValue = (v: any) => {
    // console.log("compiling", v);
    if (v.call || v.template) {
      const args = v.args.map(compileValue);

      if (
        args.filter(
          (a: any) => !(typeof a === "number") && !(typeof a === "boolean")
        ).length == 0
      ) {
        return v.call(...args);
      } else {
        if (v.call) {
          let i;
          if (fnsI[v._s] === undefined) {
            i = fncnt++;
            fnsI[v._s] = i;
            fns[i] = v._s;
          } else {
            i = fnsI[v._s];
          }
          return `f${i}(${args.join(", ")})`;
        } else {
          let s = v.template as string;

          (args as any[]).forEach((a, i) => {
            s = s.replace(new RegExp("_" + i, "g"), `(${a})`);
          });
          return s;
        }
      }
      // console.log(args, v.args);
    } else if (v.arg !== undefined) {
      return "a" + v.arg;
    } else {
      // console.log(v);
      // throw "???";
      return v;
    }
  };
  const resultingStack = result.stack.map(compileValue);
  const args = [...Array(result.args).keys()]
    .map((i) => "a" + i)
    .reverse()
    .join(", ");
  const code = `() => {
  ${Object.keys(fns)
    .map((k) => `const f${k} = ${fns[k]};`)
    .join("\n")}

  return (stack) => {
    const [${args}] = stack.splice(-${result.args});
    [${resultingStack.join(", ")}].forEach(v => stack.push(v))
  }
}`;

  // console.log(code);
  return eval(code)();

  // return () => {};
  return (dataStack) => {
    let a = dataStack.pop();
    let b = dataStack.pop();
    dataStack.push(b * 10);
    dataStack.push(Math.floor(a / 10));
  };
}

function symbolically(commands: Command[]) {
  let code: Command[] = commands;
  let dataStack: Stack = [];

  let args = 0;
  const pop = () => {
    let v = dataStack.pop();
    if (v === undefined) {
      return { arg: args++ };
    } else {
      return v;
    }
  };

  let retStack: Command[][] = [];

  let names: { [name: string]: Command[] } = {};
  let markersdefs: { [name: string]: Command[] } = {};

  let readers: { [char: string]: (val: string) => void } = {
    "#": (n) =>
      dataStack.push(
        (() => {
          if (n[0] == ":") return { marker: n.slice(1) };
          if (n[0] == "'") return n.slice(1);
          if (n == "true") return true;
          if (n == "false") return false;
          if (/^[0-9]+$/.test(n)) return parseInt(n, 10);
          throw "can't parse " + n;
        })()
      ),
    "~": (val) => {
      const a = "a".charCodeAt(0);
      const inds = [...Array(val.length).keys()]
        .map((i) => val.charCodeAt(i) - a)
        .reverse();
      const max = Math.max(...inds) + 1;

      const na = [];
      while (dataStack.length + na.length < max) {
        na.push({ arg: args++ });
      }
      na.reverse().forEach((a) => dataStack.push(a));

      const slc = dataStack.splice(-max).reverse();
      inds.forEach((i) => dataStack.push(slc[i]));
    },
    ":": (val) => {
      if (!val) {
        names[expectString(code.pop())] = collectBrackets(
          code,
          ":",
          ";"
        ).reverse();
        return;
      }

      if (!markersdefs[val]) throw "marker not defined " + val;
      call(markersdefs[val]);
    },
  };

  let call = (newCode: Command[], returnTo?: Command[]) => {
    if (code.length) retStack.push(code);
    if (returnTo) {
      retStack.push(returnTo);
    }
    code = [...newCode];
  };
  let binOp = (f: (a: Value, b: Value) => Value) => () => {
    let b = pop();
    let a = pop();

    dataStack.push({ call: f, _s: f.toString(), args: [a, b] });
  };
  let strOp = (template: string) => () => {
    let b = pop();
    let a = pop();

    dataStack.push({ template, args: [a, b] });
  };

  let nativeNames: { [name: string]: () => void } = {
    "(": () => {
      collectBrackets(code, "(", ")");
    },
    "[": () => {
      dataStack.push(collectBrackets(code, "[", "]").reverse());
    },

    call: () => call(pop()),
    times: () => {
      const block = pop();
      let times = pop();

      if (times != 0) {
        call(
          block,
          [{ pushValue: times - 1 }, { pushValue: block }, "times"].reverse()
        );
      }
    },
    "divides?": strOp("_0 % _1 === 0"),
    // escapable: () => {
    //   const block = pop();
    //   const marker = pop();

    //   if (!marker.marker) throw "[escapable] bad marker " + marker;

    //   markersdefs[marker.marker] = [{ pushValue: marker }, "escape"].reverse();
    //   call(block, [{ pushValue: marker }, "clearMarker"].reverse());
    // },
    // escape: () => {
    //   const marker = pop();

    //   if (!marker.marker) throw "[escape] bad marker " + marker;

    //   code = retStack.pop();

    //   while (
    //     !(
    //       code[0] == "clearMarker" &&
    //       (code[1] as any)?.pushValue?.marker === marker.marker
    //     )
    //   ) {
    //     code = retStack.pop();
    //   }
    // },
    // clearMarker: () => {
    //   const marker = pop();

    //   if (!marker.marker) throw "[clearMarker] bad marker " + marker;

    //   delete markersdefs[marker.marker];
    // },
    not: () => dataStack.push(!pop()),
    "+": binOp((a, b) => a + b),
    "-": binOp((a, b) => a - b),
    "*": binOp((a, b) => a * b),
    "/": binOp((a, b) => Math.floor(a / b)),
    "||": binOp((a, b) => a || b),
    "&&": strOp("_0 && _1"),
    mod: binOp((a, b) => a % b),
    "eq?": binOp(
      (a, b) => a === b || (a.marker && a.marker === b.marker) || false
    ),
    ">": binOp((a, b) => a > b),
    "<": binOp((a, b) => a < b),
    dip: () => {
      call(pop(), [{ pushValue: pop() }]);
    },
    sip: () => {
      const block = pop();
      const v = pop();
      dataStack.push(v);
      call(block, [{ pushValue: v }]);
    },
    swap: () => {
      let a = pop();
      let b = pop();
      dataStack.push(a);
      dataStack.push(b);
    },
    choose: () => {
      call(({ false: pop(), true: pop() } as any)[pop()]);
    },
    dup: () => {
      dataStack.push(dataStack[dataStack.length - 1]);
    },
    drop: () => pop(),
    "dump-stack": () => console.log(dataStack),
    print: () => console.log(pop()),
    "now!": () => dataStack.push(Date.now()),
    // compile: () => {
    //   const name = pop();
    //   const f = compile(names[name]);
    //   nativeNames[name] = () => f(dataStack);
    // },
  };

  while (true) {
    const cmd = code.pop();

    // console.log(cmd, "|||", dataStack); //, "///", retStack);
    // console.log(cmd, "|||", dataStack, "///", retStack);

    if (cmd !== undefined) {
      if (typeof cmd === "string") {
        if (nativeNames[cmd]) {
          nativeNames[cmd]();
        } else if (readers[cmd[0]]) {
          readers[cmd[0]](cmd.slice(1));
        } else if (names[cmd]) {
          call(names[cmd]);
        } else {
          throw "Can't interpret `" + cmd + "`";
        }
      } else {
        if ("pushValue" in cmd) {
          dataStack.push(cmd.pushValue);
        } else if ("marker" in cmd) {
        } else {
          throw "Can't interpret " + JSON.stringify(cmd) + "";
        }
      }
    } else {
      code = retStack.pop();
      if (!code) return { args, stack: dataStack };
    }
  }
}

function execute(commands: Command[]): Stack {
  let code: Command[] = [...commands].reverse();
  let dataStack: Stack = [];
  let retStack: Command[][] = [];

  let undefinedMarkerHandlerStack: Command[][] = [];

  const handleUndefinedMarker = (marker: string) => {
    // console.log("undef", undefinedMarkerHandlerStack);
    call(undefinedMarkerHandlerStack[undefinedMarkerHandlerStack.length - 1]);
  };

  let names: { [name: string]: Command[] } = {};
  let markersdefs: { [name: string]: Command[] } = {};

  let readers: { [char: string]: (val: string) => void } = {
    "#": (n) =>
      dataStack.push(
        (() => {
          if (n[0] == ":") return { marker: n.slice(1) };
          if (n[0] == "'") return n.slice(1);
          if (n == "true") return true;
          if (n == "false") return false;
          if (/^[0-9]+$/.test(n)) return parseInt(n, 10);
          throw "can't parse " + n;
        })()
      ),
    "~": (val) => {
      const a = "a".charCodeAt(0);
      if (true) {
        const f = compile(["~" + val]);
        nativeNames["~" + val] = () => f(dataStack);
        nativeNames["~" + val]();
        // console.log("!!!");
      } else {
        const inds = [...Array(val.length).keys()]
          .map((i) => val.charCodeAt(i) - a)
          .reverse();
        const max = Math.max(...inds) + 1;
        const slc = dataStack.splice(-max).reverse();
        inds.forEach((i) => dataStack.push(slc[i]));
      }
    },
    ":": (val) => {
      if (!val) {
        names[expectString(code.pop())] = collectBrackets(
          code,
          ":",
          ";"
        ).reverse();
        return;
      }

      runMarker(val);
    },
  };

  const runMarker = (val: string): void => {
    dataStack.push({ marker: val }); // pass marker to the handlers

    // console.log(markersdefs);
    if (!markersdefs[val]) {
      if (undefinedMarkerHandlerStack.length > 0) handleUndefinedMarker(val);
      else throw "marker not defined " + val;
    } else {
      call(markersdefs[val]);
    }
  };

  let call = (newCode: Command[], returnTo?: Command[]) => {
    if (code.length) retStack.push(code);
    if (returnTo) {
      retStack.push(returnTo);
    }
    code = [...newCode];
  };
  let binOp = (f: (a: Value, b: Value) => Value) => () => {
    let a = dataStack.pop();
    let b = dataStack.pop();
    dataStack.push(f(b, a));
  };

  let nativeNames: { [name: string]: () => void } = {
    "(": () => {
      collectBrackets(code, "(", ")");
    },
    "[": () => {
      dataStack.push(collectBrackets(code, "[", "]").reverse());
    },

    call: () => call(dataStack.pop()),
    times: () => {
      const block = dataStack.pop();
      let times = dataStack.pop();

      if (times != 0) {
        call(
          block,
          [{ pushValue: times - 1 }, { pushValue: block }, "times"].reverse()
        );
      }
    },
    escapable: () => {
      const block = dataStack.pop();
      const marker = dataStack.pop();

      if (!marker.marker) throw "[escapable] bad marker " + marker;

      markersdefs[marker.marker] = ["escape"].reverse();
      call(block, [{ pushValue: marker }, "clearMarker"].reverse());
    },
    escape: () => {
      const marker = dataStack.pop();

      if (!marker.marker) throw "[escape] bad marker " + marker;

      code = retStack.pop();

      while (
        !(
          code[0] == "clearMarker" &&
          (code[1] as any)?.pushValue?.marker === marker.marker
        )
      ) {
        code = retStack.pop();
      }
    },
    "call-with-marker-handler": () => {
      const marker = dataStack.pop();
      const handler = dataStack.pop();
      const block = dataStack.pop();

      if (!marker.marker) throw "[cwmh] bad marker " + marker;

      markersdefs[marker.marker] = handler;
      call(block, [{ pushValue: marker }, "clearMarker"].reverse());
    },
    "call-with-undefined-marker-handler": () => {
      const handler = dataStack.pop();
      const block = dataStack.pop();

      undefinedMarkerHandlerStack.push(handler);

      call(block, ["pop-undefined-marker-handler"]);
    },
    "pop-undefined-marker-handler": () => {
      undefinedMarkerHandlerStack.pop();
    },
    "push-before-block": () => {
      const v = dataStack.pop();
      const bl = dataStack.pop();
      dataStack.push([...bl, { pushValue: v }]);
    },
    "add-command-before-block": () => {
      const v = dataStack.pop();
      const bl = dataStack.pop();
      dataStack.push([...bl, v]);
    },

    clearMarker: () => {
      const marker = dataStack.pop();

      if (!marker.marker) throw "[clearMarker] bad marker " + marker;

      delete markersdefs[marker.marker];
    },
    not: () => dataStack.push(!dataStack.pop()),
    "+": binOp((a, b) => a + b),
    "-": binOp((a, b) => a - b),
    "*": binOp((a, b) => a * b),
    "/": binOp((a, b) => Math.floor(a / b)),
    "||": binOp((a, b) => a || b),
    "&&": binOp((a, b) => a && b),
    mod: binOp((a, b) => a % b),
    "eq?": binOp(
      (a, b) => a === b || (a.marker && a.marker === b.marker) || false
    ),
    ">": binOp((a, b) => a > b),
    "<": binOp((a, b) => a < b),
    dip: () => {
      call(dataStack.pop(), [{ pushValue: dataStack.pop() }]);
    },
    sip: () => {
      call(dataStack.pop(), [{ pushValue: dataStack[dataStack.length - 1] }]);
    },
    swap: () => {
      let a = dataStack.pop();
      let b = dataStack.pop();
      dataStack.push(a);
      dataStack.push(b);
    },
    choose: () => {
      call(
        ({ false: dataStack.pop(), true: dataStack.pop() } as any)[
          dataStack.pop()
        ]
      );
    },
    dup: () => {
      dataStack.push(dataStack[dataStack.length - 1]);
    },
    drop: () => dataStack.pop(),
    "dump-stack": () => console.log(dataStack),
    "dump-ret-stack": () => console.log("ret", retStack),
    print: () => console.log(dataStack.pop()),
    "now!": () => dataStack.push(Date.now()),
    compile: () => {
      const name = dataStack.pop();
      const f = compile(names[name]);
      nativeNames[name] = () => f(dataStack);
    },
  };

  while (true) {
    const cmd = code.pop();

    // console.log(cmd, "|||", dataStack); //, "///", retStack);
    // console.log(cmd, "|||", dataStack, "///", retStack);

    if (cmd !== undefined) {
      if (typeof cmd === "string") {
        if (nativeNames[cmd]) {
          nativeNames[cmd]();
        } else if (readers[cmd[0]]) {
          readers[cmd[0]](cmd.slice(1));
        } else if (names[cmd]) {
          call(names[cmd]);
        } else {
          throw "Can't interpret `" + cmd + "`";
        }
      } else {
        if ("pushValue" in cmd) {
          dataStack.push(cmd.pushValue);
        } else if ("marker" in cmd) {
          runMarker(cmd.marker);
        } else {
          throw "Can't interpret " + JSON.stringify(cmd) + "";
        }
      }
    } else {
      code = retStack.pop();
      if (!code) return dataStack;
    }
  }
}

async function main() {
  console.log("--- START ---");

  const f = await fs.open("test/euler/7.wf");
  const value = await f.readFile("utf-8");
  f.close();

  const commands = parse(stdLib + value);

  console.log("final stack:", execute(commands));
}

await main();
