println(T) :- term_string(T, S), format("~w~N",[S]).

print_state(State) :-
  state{stack:_, defs:_} :< State, !,
  term_string( State, Ss ),
  println(Ss).

% ?- print_state( state{stack:[1,2,3], defs:{}, lol:why }).

:- discontiguous execComplex/3.
:- discontiguous exec/3.

execComplex( C, S, R) :-
  state{stack:Stack} :< S,
  exec(C, Stack, Result),
  put_dict(stack, S, Result, R).

exec( times, [_, 0 |Stack], Stack).

execComplex( times, State, Final) :-

  state{stack:[Block, N|Stack]}  :< State,
  put_dict(stack, State, Stack, RState),

  program( Block, RState, Result ),
  M is N - 1,
  put_dict(stack, Result, [Block, M|Stack], Next),

  execComplex( times, Next, Final).

execComplex( define, State, Final) :-

  state{stack:[[ Name ], Block | Stack],
        defs:Defs}  :< State,
  Final = State.put(stack, Stack).put(defs, Defs.put(Name, Block)).

execComplex( Name, State, Final) :-

  state{defs:Defs}  :< State,
  get_dict(Name, Defs, Block),
  % !,

  println([Block, State]),
  program( Block, State, Final ).

/**
execComplex( Unknown, S, _ ) :-
  % !,
  print_state(S),
  term_string(Unknown, Us),
  format('~w is unknown~N', [Us]),
  false.
*/

exec( dup, [S|Stack], [S,S|Stack] ).

exec( N, Stack, [N|Stack] )
  :- number(N).
exec( print, [S|Stack], Stack)
  :- format('~w~N', [S]).

exec( [L|List], Stack, [[L|List]|Stack] ).
exec( call, [Block|Stack], Result) :-
  program( Block, Stack, Result ).

exec( plus, [A,B|Stack], [C|Stack]) :- C is A+B.
exec( mod, [A,B|Stack], [C|Stack]) :- C is A mod B.
exec( eq, [A,A|Stack], [true|Stack]).
exec( eq, [_, _|Stack], [false|Stack]).
exec( dump-stack, Stack, Stack) :- println(Stack).



program( [], State, State ).
program( [C|Cmds], State, Result ) :-
    println(C),
    print_state(State),
    execComplex(C, State, Next), !,
    program(Cmds, Next, Result).

runme :-
  % program([0, 0, 2, [
	%  1, plus           ], times, drop, print], [], R),

  program([
    [ mod, 0, eq ], [ divides ], define,

    0, 0, 100, [
    1, plus,
    dup, 3, divides,
    dump-stack
    
  ], times], state{stack:[], defs:defs{}}, R),

  term_string(R, Ss),
  print(Ss).

% ?- runme.
% ?- exec(0, [], R), print(R).

% ?- exec(plus, [1,2], R), print(R).


% ?- execComplex(lol, state{stack:[1], defs:defs{ lol:[dup] }}, R), println(R).
% ?- program([dup], state{stack:[1]}, R), println(R).
% ?- exec(dup, [1,2], R), println(R).

% ?- program([dup], state{stack:[1],defs:defs{}}, R), println(R).

?-
  % A = 2,
  execComplex(A, state{stack:[1],defs:defs{}}, state{stack:[2,1],defs:defs{}}),
  % program([A], state{stack:[1],defs:defs{}}, state{stack:[2,1],defs:defs{}}),
  println([A]).