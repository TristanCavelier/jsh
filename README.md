JSH
===

License: WTFPLv2 (see the COPYING file).

Turn your browser to a shell using jsh!

See the [demo](http://rawgit.com/TristanCavelier/jsh/master/index.html),
a kind of terminal with a javascript interpreter.

Command example:

    > 10 + 2
    12
    > ANS + 4
    16

`ANS` is the value shown by the last command. Here `ANS` is `12`.

    > jsh.getURI(location).base64().wrapLines(76);
    [..shows base64 encoded page data..]
    > jsh.value(ANS).unbase64().asText();
    [..shows clear page data..]
    > RET.downloadAs("index.html", "text/html");

`RET` is the value returned by the last command. Here `ANS` is base64 encoded
string, and `RET` is the promise returned by `asText()`.
