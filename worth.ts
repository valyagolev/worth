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

: divides? ( n n - b )   mod #0 eq? ;
: if       ( b bl - )    [ ] choose ;
: while    ( bl - )      dup [ call ] dip swap [ while ] [ drop ] choose ;
: forever  ( bl - )      dup [ call ] dip forever ;
: loop     ( mk bl - )   swap [ forever ] escapable ;
: time     ( bl - )      now! [ call ] dip now! swap - #:profile_result: print print ;

`;

function expectString(cmd: Command) {
  if (typeof cmd !== "string") throw "Bad string";
  return cmd;
}

function execute(commands: Command[]): Stack {
  let code: Command[] = [...commands].reverse();
  let dataStack: Stack = [];
  let retStack: Command[][] = [];

  let names: { [name: string]: Command[] } = {};
  let markersdefs: { [name: string]: Command[] } = {};

  let readers: { [char: string]: (val: string) => void } = {
    "#": (n) =>
      dataStack.push(
        (() => {
          if (n[0] == ":") return { marker: n.slice(1) };
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

      markersdefs[marker.marker] = [{ pushValue: marker }, "escape"].reverse();
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
    mod: binOp((a, b) => a % b),
    "eq?": binOp((a, b) => a === b),
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
    print: () => console.log(dataStack.pop()),
    "now!": () => dataStack.push(Date.now()),
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
      if (!code) return dataStack;
    }
  }
}

async function main() {
  console.log("--- START ---");

  const f = await fs.open("test/euler/4.wf");
  const value = await f.readFile("utf-8");
  f.close();

  const commands = parse(stdLib + value);

  console.log(execute(commands));
}

await main();
