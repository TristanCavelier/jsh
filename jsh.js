/*jslint indent: 2 */
(function (exports) {
  "use strict";
  /*! Copyright (c) 2015 Tristan Cavelier <t.cavelier@free.fr>
      This program is free software. It comes without any warranty, to
      the extent permitted by applicable law. You can redistribute it
      and/or modify it under the terms of the Do What The Fuck You Want
      To Public License, Version 2, as published by Sam Hocevar. See
      the COPYING file for more details. */

  /*jslint nomen: true */
  /*global console, setTimeout, prompt, alert, btoa, atob,
           Blob, ArrayBuffer, XMLHttpRequest, FileReader, Uint8Array */

  function CancellablePromise(executor, canceller) {
    this._canceller = canceller;
    this._promise = new Promise(executor);
  }

  CancellablePromise.prototype.then = function (a, b) {
    return this._promise.then(a, b);
  };

  CancellablePromise.prototype.catch = function (b) {
    return this._promise.catch(b);
  };

  // just send a cancel signal
  CancellablePromise.prototype.cancel = function () {
    if (typeof this._canceller === "function") {
      try { this._canceller(); } catch (ignore) {}
      // return this;
    }
    // throw new Error("Cannot cancel this promise.");
    return this;
  };

  /**
   *     all(promises): Promise< promises_fulfilment_values >
   *     all(promises): Promise< one_rejected_reason >
   *
   * Produces a promise that is resolved when all the given `promises` are
   * fulfilled. The fulfillment value is an array of each of the fulfillment
   * values of the promise array.
   *
   * If one of the promises is rejected, the `all` promise will be rejected with
   * the same rejected reason, and the remaining unresolved promises recieve a
   * cancel signal.
   *
   * @param  {Array} promises An array of promises
   * @return {Promise} A promise
   */
  CancellablePromise.all = function (promises) {
    var length = promises.length;

    function onCancel() {
      var i;
      for (i = 0; i < promises.length; i += 1) {
        if (typeof promises[i].cancel === "function") {
          promises[i].cancel();
        }
      }
    }

    if (length === 0) {
      return new CancellablePromise(function (done) { done([]); });
    }

    return new CancellablePromise(function (resolve, reject) {
      var i, count = 0, results = [];
      function resolver(i) {
        return function (value) {
          count += 1;
          results[i] = value;
          if (count === length) {
            resolve(results);
          }
        };
      }

      function rejecter(err) {
        reject(err);
        onCancel();
      }

      for (i = 0; i < length; i += 1) {
        promises[i].then(resolver(i), rejecter);
      }
    }, onCancel);
  };

  /**
   *     race(promises): promise< first_value >
   *
   * Produces a promise that is fulfilled when any one of the given promises is
   * fulfilled. As soon as one of the promises is resolved, whether by being
   * fulfilled or rejected, all the promises receive a cancel signal.
   *
   * @param  {Array} promises An array of promises
   * @return {Promise} A promise
   */
  CancellablePromise.race = function (promises) {
    var length = promises.length;

    function onCancel() {
      var i;
      for (i = 0; i < promises.length; i += 1) {
        if (typeof promises[i].cancel === "function") {
          promises[i].cancel();
        }
      }
    }

    return new CancellablePromise(function (resolve, reject) {
      var i, ended = false;
      function resolver(value) {
        if (!ended) {
          ended = true;
          resolve(value);
          onCancel();
        }
      }

      function rejecter(err) {
        if (!ended) {
          ended = true;
          reject(err);
          onCancel();
        }
      }

      for (i = 0; i < length; i += 1) {
        promises[i].then(resolver, rejecter);
      }
    }, onCancel);
  };

  /**
   *     spawn(generator): CancellablePromise< returned_value >
   *
   * Use generator function to do asynchronous operations sequentialy using
   * `yield` operator.
   *
   *     spawn(function* () {
   *       try {
   *         var config = yield getConfig();
   *         config.enableSomething = true;
   *         yield sleep(1000);
   *         yield putConfig(config);
   *       } catch (e) {
   *         console.error(e);
   *       }
   *     });
   *
   * @param  {Function} generator A generator function.
   * @return {CancellablePromise} A new cancellable promise
   */
  CancellablePromise.spawn = function (generator) {
    var promise, cancelled;
    return new CancellablePromise(function (done, fail) {
      var g = generator(), prev_value, next = {};
      function rec(method) {
        if (cancelled) {
          return fail(new Error("Cancelled"));
        }
        try {
          next = g[method](prev_value);
        } catch (e) {
          return fail(e);
        }
        if (next.done) {
          return done(next.value);
        }
        promise = next.value;
        if (!promise || typeof promise.then !== "function") {
          // The value is not a thenable. However, the user used `yield`
          // anyway. It means he wants to left hand to another process.
          promise = new CancellablePromise(function (d) { d(promise); });
        }
        return promise.then(function (a) {
          prev_value = a;
          rec("next");
        }, function (e) {
          prev_value = e;
          rec("throw");
        });
      }
      rec("next");
    }, function () {
      cancelled = true;
      if (promise && typeof promise.cancel === "function") {
        promise.cancel();
      }
    });
  };

  /**
   *     sequence(thenArray): CancellablePromise< returned_value >
   *
   * An alternative to `CancellablePromise.spawn`, but instead of using a
   * generator function, it uses an array of function like in then chains.
   * This function works with old ECMAScript version.
   *
   *     var config;
   *     sequence([function () {
   *       return getConfig();
   *     }, function (_config) {
   *       config = _config;
   *       config.enableSomething = true;
   *       return sleep(1000);
   *     }, function () {
   *       return putConfig(config);
   *     }, [null, function (e) {
   *       console.error(e);
   *     }]]);
   *
   * @param  {Array} thenArray An array of function.
   * @return {CancellablePromise} A new cancellable promise
   */
  CancellablePromise.sequence = function (array) {
    return CancellablePromise.spawn(function () {
      var i = 0, g;
      function exec(f, value) {
        try {
          value = f(value);
          if (i === array.length) {
            return {"done": true, "value": value};
          }
          return {"value": value};
        } catch (e) {
          return g["throw"](e);
        }
      }
      g = {
        "next": function (value) {
          var f;
          while (i < array.length) {
            if (Array.isArray(array[i])) {
              f = array[i][0];
            } else {
              f = array[i];
            }
            if (typeof f === "function") {
              i += 1;
              return exec(f, value);
            }
            i += 1;
          }
          return {"done": true, "value": value};
        },
        "throw": function (value) {
          var f;
          while (i < array.length) {
            if (Array.isArray(array[i])) {
              f = array[i][1];
            }
            if (typeof f === "function") {
              i += 1;
              return exec(f, value);
            }
            i += 1;
          }
          throw value;
        }
      };
      return g;
    });
  };

  CancellablePromise.defer = function () {
    var d = {};
    d.promise = new CancellablePromise(function (done, fail) {
      d.resolve = done;
      d.reject = fail;
    }, function () {
      d.oncancel();
    });
    return d;
  };

  exports.CancellablePromise = CancellablePromise;


  var jsh, resolve = function (v) {
    return new CancellablePromise(function (r) {
      r(v);
    });
  }, reject = function (v) {
    return new CancellablePromise(function (_, r) {
      /*jslint unparam: true */
      r(v);
    });
  }, resolved = resolve(), seq = CancellablePromise.sequence, defer = CancellablePromise.defer;

  function JSH(promise, onDone, onFail, previous) {
    var it = this;
    if (!promise || typeof promise.then !== "function") {
      if (typeof onDone === "function") {
        promise = resolve(promise);
      } else {
        it._r = resolve(promise);
        return;
      }
    }
    function _onDone(v) {
      delete it._cf;
      delete it._previous;
      if (it._cancelled) { return; }
      if (typeof onDone !== "function") {
        return v;
      }
      it._value = onDone(v);
      if (it._cancelled) {
        if (it._value && typeof it._value.then === "function" && typeof it._value.cancel === "function") {
          try { it._value.cancel(); } catch (ignore) {}
        }
      }
      return it._value;
    }
    function _onFail(v) {
      delete it._cf;
      delete it._previous;
      if (it._cancelled) { return; }
      if (typeof onFail !== "function") {
        return reject(v);
      }
      it._value = onFail(v);
      if (it._cancelled) {
        if (it._value && typeof it._value.then === "function" && typeof it._value.cancel === "function") {
          try { it._value.cancel(); } catch (ignore) {}
        }
      }
      return it._value;
    }
    it._previous = previous;
    it._c = new Promise(function (d, f) {
      /*jslint unparam: true */
      it._cf = f;
    });
    it._r = Promise.race([it._c, promise.then(_onDone, _onFail)]);
  }
  JSH.prototype.then = function (onDone, onFail) {
    return new JSH(this._r, onDone, onFail, this);
  };
  JSH.prototype.catch = function (onFail) {
    return this.then(null, onFail);
  };
  JSH.prototype.cancel = function () {
    this._cancelled = true;
    if (typeof this._cf === "function") {
      try { this._cf(new Error("Cancelled")); } catch (ignore) {}
    }
    if (this._value && typeof this._value.then === "function" && typeof this._value.cancel === "function") {
      try { this._value.cancel(); } catch (ignore) {}
    }
    if (this._previous && typeof this._previous.then === "function" && typeof this._previous.cancel === "function") {
      try { this._previous.cancel(); } catch (ignore) {}
    }
  };
  JSH.prototype.detach = function () {
    return new JSH(this._r);
  };


  function emptyFunction() { return; }
  function returnTrue() { return true; }

  function asString(value) {
    if (value === undefined) {
      return "undefined";
    }
    if (value === null) {
      return "null";
    }
    return value.toString();
  }

  function objectUpdate(o1, o2) {
    Object.keys(o2).forEach(function (key) {
      o1[key] = o2[key];
    });
    return o1;
  }

  function objectSetDefaults(o1, o2) {
    Object.keys(o2).forEach(function (key) {
      if (o1[key] !== undefined) {
        o1[key] = o2[key];
      }
    });
    return o1;
  }

  function saveAs(filename, mimetype, data) {
    /**
     * Allows the user to download `data` as a file which name is defined by
     * `filename`. The `mimetype` will help the browser to choose the associated
     * application to open with.
     *
     * @param  {String} filename The file name.
     * @param  {String} mimetype The data type.
     * @param  {Any} data The data to download.
     */
    data = window.URL.createObjectURL(new Blob([data], {"type": mimetype}));
    var a = document.createElement("a");
    if (a.download !== undefined) {
      a.download = filename;
      a.href = data;
      //a.textContent = 'Downloading...';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } else {
      window.open(data);
    }
  }

  function range() {
    var args = [].reduce.call(arguments, function (prev, value) {
      var t = typeof value;
      if (t === "number" && isNaN(t)) { return prev; }
      prev[t] = prev[t] || [];
      prev[t].push(value);
    }, {}), start, end, step, tester, callback;
    if (args.number.length < 1) {
      throw new Error("range() At least one number is required");
    }
    if (args.function.length < 1) {
      throw new Error("range() One function is required");
    }
    callback = args.function[0];
    tester = function () { return start < end; };
    if (args.number.length === 1) {
      start = 0;
      end = args.number[0];
      step = 1;
    } else if (args.number.length === 2) {
      start = args.number[0];
      end = args.number[1];
      step = 1;
    } else {
      start = args.number[0];
      end = args.number[1];
      step = args.number[2];
      if (step === 0) { throw new Error("range() step must not be zero"); }
      if (step < 0) { tester = function () { return start > end; }; }
    }
    while (tester()) {
      callback(start);
      start += step;
    }
  }

  function arrayBufferToBinaryString(arrayBuffer) {
    return [].reduce.call(new Uint8Array(arrayBuffer), function (prev, b) {
      return prev + String.fromCharCode(b);
    }, "");
  }

  function binaryStringToArrayBuffer(binaryString) {
    var ua = new Uint8Array(binaryString.length), i;
    for (i = 0; i < binaryString.length; i += 1) {
      ua[i] = binaryString.charCodeAt(i);
    }
    return ua.buffer;
  }

  function readBlobAsText(blob) {
    var fr;
    return new CancellablePromise(function (resolve, reject) {
      fr = new FileReader();
      fr.onload = function (ev) { return resolve(ev.target.result); };
      fr.onerror = function () { return reject(new Error("Unable to read blob as text")); };
      fr.readAsText(blob);
    }, function () {
      fr.abort();
    });
  }

  function readBlobAsArrayBuffer(blob) {
    var fr;
    return new CancellablePromise(function (resolve, reject) {
      fr = new FileReader();
      fr.onload = function (ev) { return resolve(ev.target.result); };
      fr.onerror = function () { return reject(new Error("Unable to read blob as ArrayBuffer")); };
      fr.readAsArrayBuffer(blob);
    }, function () {
      fr.abort();
    });
  }

  function readBlobAsBinaryString(blob) {
    var fr;
    return new CancellablePromise(function (resolve, reject) {
      fr = new FileReader();
      fr.onload = function (ev) { return resolve(ev.target.result); };
      fr.onerror = function () { return reject(new Error("Unable to read blob as binary string")); };
      fr.readAsBinaryString(blob);
    }, function () {
      fr.abort();
    });
  }

  function noCancel(promise) {
    return new Promise(function (done, fail) {
      promise.then(done, fail);
    });
  }

  function toThenable(v) {
    if (v && typeof v.then === "function") { return v; }
    return {then: function (done) {
      return toThenable(done(v));
    }};
  }


  JSH.prototype.addMethod = function (name, method) {
    var proto = Object.getPrototypeOf(this);
    if (proto[name] !== undefined) {
      throw new Error(name + "() is already defined");
    }
    proto[name] = function () {
      var args = arguments, it = this;
      return this.then(function (input) {
        return method.apply(it, [input].concat(args));
      });
    };
    return this;
  };

  JSH.prototype.value = function (value) {
    return this.then(function () {
      return value;
    });
  };

  JSH.prototype.call = function (thisArg, fn) {
    var args = [].slice.call(arguments, 2);
    return this.then(function (input) {
      return fn.apply(thisArg, args.concat([input]));
    });
  };

  JSH.prototype.apply = function (thisArg, fn, args) {
    return this.then(function (input) {
      return fn.apply(thisArg, [].concat(args, [input]));
    });
  };

  JSH.prototype.prompt = function (message) {
    return this.then(function (_message) {
      if (message !== undefined) { _message = message; }
      if (_message !== undefined) {
        return prompt(_message);
      }
      return prompt();
    });
  };

  JSH.prototype.log = function (prefix) {
    return this.then(function (a) {
      if (prefix !== undefined) {
        console.log(prefix, a);
      } else {
        console.log(a);
      }
      return a;
    }, function (e) {
      if (prefix !== undefined) {
        console.error(prefix, e);
      } else {
        console.error(e);
      }
      throw e;
    });
  };

  JSH.prototype.alert = function (message) {
    return this.then(function (_message) {
      if (message !== undefined) { _message = message; }
      if (_message !== undefined) {
        alert(_message);
      }
      return _message;
    });
  };

  JSH.prototype.toBlob = function () {
    // TODO if input === undefined, return undefined too ?
    return this.then(function (input) {
      if (input instanceof ArrayBuffer || input.buffer instanceof ArrayBuffer) {
        return new Blob([input]);
      }
      if (input === undefined || input === null) {
        return new Blob([""]);
      }
      if (input instanceof Blob) {
        return input;
      }
      return new Blob([input]);
    });
  };

  JSH.prototype.toText = function () {
    // TODO if input === undefined, return undefined too ?
    return this.then(function (input) {
      if (input === undefined || input === null) {
        return "";
      }
      if (typeof input === "string") {
        return input;
      }
      if (input instanceof Blob) {
        return readBlobAsText(input);
      }
      if (input instanceof ArrayBuffer || input.buffer instanceof ArrayBuffer) {
        return readBlobAsText(new Blob([input]));
      }
      return readBlobAsText(new Blob([input]));
    });
  };

  JSH.prototype.toArrayBuffer = function () {
    // TODO if input === undefined, return undefined too ?
    return this.then(function (input) {
      if (input instanceof Blob) {
        return readBlobAsArrayBuffer(input);
      }
      if (input instanceof ArrayBuffer) {
        return input;
      }
      if (input.buffer instanceof ArrayBuffer) {
        return input.buffer;
      }
      if (input === undefined || input === null) {
        return "";
      }
      if (typeof input === "string") {
        return input;
      }
      return readBlobAsText(new Blob([input]));
    });
  };

  JSH.prototype.toDataURL = function (contentType) {
    // TODO check contentType with regex?
    // TODO remove /;base64(;|$)/ from contentType?
    return this.base64().then(function (input) {
      return "data:" + contentType + ";base64," + input;
    });
  };

  JSH.prototype.sleep = function (ms) {
    return this.then(function (input) {
      var d = defer(), i = setTimeout(d.resolve, ms, input);
      d.oncancel = function () { d.fail(new Error("Cancelled")); };
      return d.promise;
    });
  };

  JSH.prototype.never = function () {
    return this.then(function () {
      var d = defer();
      d.oncancel = function () { d.fail(new Error("Cancelled")); };
      return d.promise;
    });
  };

  JSH.prototype.get = function (key, _default) {
    return this.then(function (object) {
      if (Array.isArray(key)) {
        key.forEach(function (key) {
          object = object[key];
        });
        if (object === undefined) { return _default; }
        return object;
      }
      object = object[key];
      if (object === undefined) { return _default; }
      return object;
    });
  };

  JSH.prototype.getFrom = function (object, key, _default) {
    return this.then(function () {
      if (Array.isArray(key)) {
        key.forEach(function (key) {
          object = object[key];
        });
        if (object === undefined) { return _default; }
        return object;
      }
      object = object[key];
      if (object === undefined) { return _default; }
      return object;
    });
  };

  JSH.prototype.set = function (key, value) {
    return this.then(function (object) {
      if (Array.isArray(key)) {
        key.slice(0, -1).reduce(function (prev, key) {
          return prev[key];
        }, object)[key[key.length - 1]] = value;
      }
      object[key] = value;
      return object;
    });
  };

  JSH.prototype.setTo = function (object, key) {
    return this.then(function (value) {
      if (Array.isArray(key)) {
        key.slice(0, -1).reduce(function (prev, key) {
          return prev[key];
        }, object)[key[key.length - 1]] = value;
      }
      object[key] = value;
      return object;
    });
  };

  JSH.prototype.setDefaults = function (defaults) {
    return this.then(function (object) {
      Object.keys(defaults).forEach(function (key) {
        if (object[key] === undefined) {
          object[key] = defaults[key];
        }
      });
      return object;
    });
  };

  JSH.prototype.setDefaultsTo = function (object) {
    return this.then(function (defaults) {
      Object.keys(defaults).forEach(function (key) {
        if (object[key] === undefined) {
          object[key] = defaults[key];
        }
      });
      return object;
    });
  };

  JSH.prototype.split = function (separator, limit) {
    return this.then(function (input) {
      return input.split(separator, limit);
    });
  };

  JSH.prototype.slice = function (a, b, c) {
    return this.then(function (input) {
      return input.slice(a, b, c);
    });
  };

  JSH.prototype.join = function (separator) {
    return this.then(function (input) {
      return input.join(separator);
    });
  };

  JSH.prototype.sort = function (compareFn) {
    return this.then(function (input) {
      return input.sort(compareFn);
    });
  };

  JSH.prototype.replace = function (pattern, by) {
    return this.then(function (input) {
      return input.replace(pattern, by);
    });
  };

  JSH.prototype.toSlices = function (size) {
    return this.then(function (value) {
      var l = value.length || value.size || 0, slices = [], i;
      for (i = size; i < l; i += size) {
        slices.push(value.slice(i - size, i));
      }
      if (i >= l) { slices.push(value.slice(i - size, l)); }
      return slices;
    });
  };

  JSH.prototype.downloadAs = function () {
    /**
     *     jsh.value(input).downloadAs("myFile", "text/plain");
     *     jsh.value(input).downloadAs({"filename": "myFile", "mimetype": "text/plain"});
     *     jsh.value(input).downloadAs({"filename": "myFile"}, "text/plain");
     *
     * Allows the user to download `input` as a file which name is defined by
     * `filename`. The `mimetype` will help the browser to choose the associated
     * application to open with.
     *
     * @param  {String} filename The file name.
     * @param  {String} mimetype The data type.
     * @return {JSH} The input in JSH promise.
     */
    var args = [].reduce.call(arguments, function (prev, value) {
      var t = typeof value;
      if (prev[t]) { prev[t].push(value); }
      return prev;
    }, {"string": [], "object": []});
    if (!args.object[0]) { args.object[0] = {}; }
    return this.then(function (input) {
      saveAs(
        args.string.shift() || args.object[0].filename,
        args.string.shift() || args.object[0].mimetype,
        input
      );
      return input;
    });
  };

  JSH.prototype.forEach = function (callback) {
    return this.then(function (array) {
      if (array.length === 0) { return; }
      var i = 0;
      function wrappedCallback() { return callback(array[i], i, array); }
      function afterCallback() {
        i += 1;
        return i < array.length;
      }
      return jsh.while(function () {
        return jsh.then(wrappedCallback).then(afterCallback);
      }).then(function () { return array; });
    });
  };

  JSH.prototype.reduce = function (callback, prev) {
    var args = arguments;
    return this.then(function (array) {
      if (array.length === 0) { return; }
      var i = 0;
      if (args.length < 2) {
        i += 1;
        prev = array[0];
        if (array.length === 1) { return; }
      }
      function wrappedCallback() { return callback(prev, array[i], i, array); }
      function afterCallback(v) {
        prev = v;
        i += 1;
        return i < array.length;
      }
      return jsh.while(function () {
        return jsh.then(wrappedCallback).then(afterCallback);
      }).then(function () { return prev; });
    });
  };

  JSH.prototype.map = function (callback) {
    var newArray = [];
    return this.then(function (array) {
      if (array.length === 0) { return newArray; }
      var i = 0;
      function wrappedCallback() { return callback(array[i], i, array); }
      function afterCallback(value) {
        newArray[i] = value;
        i += 1;
        return i < array.length;
      }
      return jsh.while(function () {
        return jsh.then(wrappedCallback).then(afterCallback);
      }).then(function () { return newArray; });
    });
  };

  JSH.prototype.remap = function (callback) {
    var _array;
    return this.then(function (array) {
      if (array.length === 0) { return array; }
      _array = array;
      var i = 0;
      function wrappedCallback() { return callback(array[i], i, array); }
      function afterCallback(value) {
        array[i] = value;
        i += 1;
        return i < array.length;
      }
      return jsh.while(function () {
        return jsh.then(wrappedCallback).then(afterCallback);
      }).then(function () { return _array; });
    });
  };

  JSH.prototype.forEachSlice = function (size, callback) {
    return this.toSlices(size).forEach(callback);
  };

  JSH.prototype.forEachLine = function (callback) {
    return this.toText().split("\n").then(function (array) {
      if (array[array.length - 1] === "") { array.length -= 1; }
      return array;
    }).forEach(callback);
  };

  JSH.prototype.countLines = function () {
    return this.toText().then(function (input) {
      if (input === "") { return 0; }
      var count = 1, i;
      for (i = 0; i < input.length; i += 1) {
        if (input[i] === "\n" && input[i + 1] !== undefined) {
          count += 1;
        }
      }
      return count;
    });
  };

  JSH.prototype.waitAll = function () {
    return this.then(function (array) {
      return CancellablePromise.all(array);
    });
  };

  JSH.prototype.forRange = function () {
    var args = [].reduce.call(arguments, function (prev, value) {
      var t = typeof value;
      if (t === "number" && isNaN(t)) { return prev; }
      prev[t] = prev[t] || [];
      prev[t].push(value);
    }, {});
    return this.then(function (input) {
      var start, end, step, tester, callback;
      if (args.number.length < 1) {
        throw new Error("forRange() At least one number is required");
      }
      if (args.function.length < 1) {
        throw new Error("forRange() One function is required");
      }
      callback = args.function[0];
      tester = function () { return start < end; };
      if (args.number.length === 1) {
        start = 0;
        end = args.number[0];
        step = 1;
      } else if (args.number.length === 2) {
        start = args.number[0];
        end = args.number[1];
        step = 1;
      } else {
        start = args.number[0];
        end = args.number[1];
        step = args.number[2];
        if (step === 0) { throw new Error("forRange() step must not be zero"); }
        if (step < 0) { tester = function () { return start > end; }; }
      }
      function incrementStart() { start += step; }
      function wrappedCallback() { return callback(start, input); }
      return jsh.while(tester, function () {
        return jsh.then(wrappedCallback).then(incrementStart);
      });
    });
  };

  JSH.prototype.while = function (tester, loop) {
    return this.then(function (input) {
      var d = defer(), cancelled, currentPromise;
      d.oncancel = function () {
        cancelled = true;
        currentPromise.cancel(); // can throw, don't care
      };
      function cancel() {
        d.reject(new Error("Cancelled"));
      }
      function wrappedTester() {
        if (cancelled) { return cancel(); }
        return tester(input);
      }
      function wrappedLoop() {
        if (cancelled) { return cancel(); }
        return loop(input);
      }
      function recWithLoop() {
        currentPromise = jsh.then(wrappedTester).then(function (result) {
          if (result) { return jsh.then(wrappedLoop).then(recWithLoop); }
          d.resolve();
        }).then(null, d.reject);
      }
      function recWithoutLoop() {
        currentPromise = jsh.then(wrappedTester).then(function (result) {
          if (result) { return recWithoutLoop(); }
          d.resolve();
        }).then(null, d.reject);
      }
      if (typeof loop === "function") {
        recWithLoop();
      } else {
        recWithoutLoop();
      }
      return d.promise;
    });
  };

  JSH.prototype.loop = function (callback) {
    // Infinite loop until error
    return this.while(function () {
      return true;
    }, callback);
  };

  JSH.prototype.ifelse = function (tester, onOk, onKo) {
    var input;
    return this.then(function (_input) {
      input = _input;
      return tester();
    }).then(function (result) {
      if (result) {
        if (typeof onOk === "function") {
          return onOk(input);
        }
      } else {
        if (typeof onKo === "function") {
          return onKo(input);
        }
      }
    });
  };

  JSH.prototype.if = function (tester, callback) {
    return jsh.ifelse(tester, callback);
  };

  JSH.prototype.base64 = function () {
    return this.toArrayBuffer().then(function (arrayBuffer) {
      var bs = "", ua = new Uint8Array(arrayBuffer), l = ua.length, i;
      for (i = 0; i < l; i += 1) {
        bs += String.fromCharCode(ua[i]);
      }
      return bs;
    }).then(btoa);
  };
  JSH.prototype.unbase64 = function () {
    return this.toText().then(atob).then(function (binaryString) {
      var ua = new Uint8Array(binaryString.length), i;
      for (i = 0; i < binaryString.length; i += 1) {
        ua[i] = binaryString.charCodeAt(i);
      }
      return new Blob([ua.buffer]);
    });
  };

  function btoh(binaryString) {
    var r = "", i;
    for (i = 0; i < binaryString.length; i += 1) {
      r += ("0" + binaryString.charCodeAt(i).toString(16)).slice(-2);
    }
    return r;
  }
  exports.btoh = btoh;

  function htob(text) {
    var r = "", i, c;
    text = text.replace(/\s/g, "");
    if (text.length % 2) {
      text += "0";
    }
    for (i = 0; i < text.length; i += 2) {
      c = (parseInt(text[i], 16) * 0x10) + parseInt(text[i + 1], 16);
      if (isNaN(c)) {
        c = new Error("String contains an invalid character");
        c.name = "InvalidCharacterError";
        c.code = 5;
        throw c;
      }
      r += String.fromCharCode(c);
    }
    return r;
  }
  exports.htob = htob;

  JSH.prototype.hex = function () {
    return this.toArrayBuffer().then(function (arrayBuffer) {
      var bs = "", ua = new Uint8Array(arrayBuffer), l = ua.length, i;
      for (i = 0; i < l; i += 1) {
        bs += String.fromCharCode(ua[i]);
      }
      return bs;
    }).then(btoh);
  };
  JSH.prototype.unhex = function () {
    return this.toText().then(htob).then(function (binaryString) {
      var ua = new Uint8Array(binaryString.length), i;
      for (i = 0; i < binaryString.length; i += 1) {
        ua[i] = binaryString.charCodeAt(i);
      }
      return new Blob([ua.buffer]);
    });
  };

  JSH.prototype.wrapLines = function (wrap) {
    // TODO make it cancellable
    if (!(wrap > 0)) {
      return this.toText();
    }
    return this.toText().then(function (text) {
      var lines = [];
      text.split("\n").forEach(function (line) {
        while (line) {
          lines.push(line.slice(0, wrap));
          line = line.slice(wrap);
        }
      });
      return lines.join("\n");
    });
  };

  function headersAsKeyValue(sHeaders) {
    // Server:   SimpleHTTP/0.6 Python/3.4.1\r\n
    // Date: Wed, 04 Jun 2014 14:06:57 GMT   \r\n
    // Value: hello\r\n     guys  \r\n
    // Content-Type: application/x-silverlight\r\n
    // Content-Length: 11240\r\n
    // Last-Modified: Mon, 03 Dec 2012 23:51:07 GMT\r\n
    // X-Cache: HIT via me\r\n
    // X-Cache: HIT via other\r\n

    // { "Server": "SimpleHTTP/0.6 Python/3.4.1",
    //   "Date": "Wed, 04 Jun 2014 14:06:57 GMT",
    //   "Value": "hello guys",
    //   "Content-Type": "application/x-silverlight",
    //   "Content-Length": "11240",
    //   "Last-Modified": "Mon, 03 Dec 2012 23:51:07 GMT",
    //   "X-Cache": "HIT via me, HIT via other" }

    /*jslint regexp: true */
    var result = {}, key, value = "";
    sHeaders.split("\r\n").forEach(function (line) {
      if (line[0] === " " || line[0] === "\t") {
        value += " " + line.replace(/^\s*/, "").replace(/\s*$/, "");
      } else {
        if (key) {
          if (result[key]) {
            result[key] += ", " + value;
          } else {
            result[key] = value;
          }
        }
        key = /^([^:]+)\s*:\s*(.*)$/.exec(line);
        if (key) {
          value = key[2].replace(/\s*$/, "");
          key = key[1];
        }
      }
    });
    return result;
  }

  JSH.prototype.ajax = function (param) {
    /**
     *    jsh.ajax({url: location, responseType: "text"}).get("data");
     *    jsh.ajax({url: location}).get("Content-Length");
     *    jsh.value(input).ajax({url: there, method: "put"})
     *
     * Send request with XHR and return a promise. xhr.onload: The promise is
     * resolved when the status code is lower than 400 with a forged response
     * object as resolved value. xhr.onerror: reject with an Error (with status
     * code in status property) as rejected value.
     *
     * @param  {Object} param The parameters
     * @param  {String} param.url The url
     * @param  {String} [param.method="GET"] The request method
     * @param  {String} [param.responseType=""] The data type to retrieve
     * @param  {String} [param.overrideMimeType] The mime type to override
     * @param  {Object} [param.headers] The headers to send
     * @param  {Any} [param.data] The data to send
     * @param  {Boolean} [param.withCredentials] Tell the browser to use
     *   credentials
     * @param  {Object} [param.xhrFields] The other xhr fields to fill
     * @param  {Boolean} [param.getEvent] Tell the method to return the
     *   response event.
     * @param  {Function} [param.beforeSend] A function called just before the
     *   send request. The first parameter of this function is the XHR object.
     * @param  {String} [param.inputKey="data"|"url"] The key to set thank to
     *   the input.
     * @return {JSH<Object>} Response object is like { data: .., header1: ..,
     *   header2: .., ... }
     */
    return this.then(function (input) {
      if (param.inputKey === undefined) {
        if (param.data === undefined) {
          param.data = input; // can be disable if param.data = null
        } else if (param.url === undefined && typeof input === "string") {
          param.url = input;
        }
      } else {
        param[param.inputKey] = input;
      }
      var xhr = new XMLHttpRequest();
      return new CancellablePromise(function (done, fail) {
        var k;
        xhr.open((param.method || "GET").toUpperCase(), param.url || param.uri, true);
        xhr.responseType = param.responseType || "";
        if (param.overrideMimeType) {
          xhr.overrideMimeType(param.overrideMimeType);
        }
        if (param.withCredentials !== undefined) {
          xhr.withCredentials = param.withCredentials;
        }
        if (param.headers) {
          for (k in param.headers) {
            if (param.headers.hasOwnProperty(k)) {
              xhr.setRequestHeader(k, param.headers[k]);
            }
          }
        }
        xhr.addEventListener("load", function (e) {
          if (param.getEvent) { return done(e); }
          if (e.target.status < 400) {
            var r = headersAsKeyValue(e.target.getAllResponseHeaders());
            r.data = e.target.response;
            return done(r);
          }
          return fail(objectUpdate(new Error("request: " + (e.target.statusText || "unknown error")), {"status": e.target.status}));
        }, false);
        xhr.addEventListener("error", function (e) {
          if (param.getEvent) { return done(e); }
          return fail(new Error("request: error"));
        }, false);
        xhr.addEventListener("abort", function (e) {
          if (param.getEvent) { return done(e); }
          return fail(new Error("request: aborted"));
        }, false);
        if (param.xhrFields) {
          for (k in param.xhrFields) {
            if (param.xhrFields.hasOwnProperty(k)) {
              xhr[k] = param.xhrFields[k];
            }
          }
        }
        if (typeof param.beforeSend === 'function') {
          param.beforeSend(xhr);
        }
        xhr.send(param.data);
      }, function () {
        xhr.abort();
      });
    });
  };

  function methodURI(method) {
    return function (uri) {
      var it = this;
      return it.then(function () {
        var _uri = uri && uri.uri || uri;
        var tmp = (/^([a-z]+):/).exec(_uri);
        if (tmp) {
          tmp = method +
                tmp[1].slice(0, 1).toUpperCase() + tmp[1].slice(1).toLowerCase() +
                "URI";
          if (typeof it[tmp] === "function") {
            return it[tmp](uri);
          }
          throw new Error("No method " + tmp + " found");
        }
        throw new Error("Cannot find URI method");
      });
    };
  }

  JSH.prototype.getURI = methodURI("get");
  JSH.prototype.putURI = methodURI("put");
  JSH.prototype.deleteURI = methodURI("delete");

  function methodHttpURI(method) {
    return function (uri) {
      var obj = {
        "method": method,
        "responseType": "blob",
        "withCredentials": true
      }, verbose;
      return this.then(function () {
        obj.uri = uri && uri.uri || uri;
        if (uri && uri.verbose || false) { verbose = true }
      }).ajax(obj).then(function (e) {
        if (verbose) { return e; }
        return e.data;
      });
    };
  }

  JSH.prototype.getHttpURI = methodHttpURI("GET");
  JSH.prototype.putHttpURI = methodHttpURI("PUT");
  JSH.prototype.deleteHttpURI = methodHttpURI("DELETE");
  JSH.prototype.getHttpsURI = methodHttpURI("GET");
  JSH.prototype.putHttpsURI = methodHttpURI("PUT");
  JSH.prototype.deleteHttpsURI = methodHttpURI("DELETE");
  JSH.prototype.getDataURI = methodHttpURI("GET");
  JSH.prototype.getFileURI = methodHttpURI("GET");

  JSH.prototype.getLocalstorageURI = function (uri) {
    return this.then(function () {
      var v = localStorage.getItem(uri.replace(/^localstorage:/, ""));
      if (v === null) {
        throw objectUpdate(new Error("localStorage: Not Found"), {"status": 404});
      }
      return new Blob([v]);
    });
  };
  JSH.prototype.putLocalstorageURI = function (uri) {
    return this.toText().then(function (input) {
      localStorage.setItem(uri.replace(/^localstorage:/, ""), input);
    });
  };
  JSH.prototype.deleteLocalstorageURI = function (uri) {
    return this.then(function () {
      localStorage.removeItem(uri.replace(/^localstorage:/, ""));
    });
  };

  JSH.prototype.prompttextarea = function () {
    // TODO make it act like prompt but with a textarea
    // TODO replace prompt by this function?
    // TODO add option.placeholder
    return this.then(function () {
      var canceller = emptyFunction;
      return new CancellablePromise(function (done, fail) {
        var textarea = document.createElement("textarea");
        textarea.style.position = "absolute";
        textarea.placeholder = "Press Ctrl+Enter to validate this textarea, or press Escape to invalidate it.";
        textarea.addEventListener("keydown", function thisFun(e) {
          if (e.key === "Esc" || e.key === "Escape" || e.keyIdentifier === "U+001B") {
            textarea.removeEventListener("keydown", thisFun);
            textarea.remove();
            fail(new Error("textarea() exited"));
          } else if ((e.key === "Enter" || e.keyIdentifier === "Enter") && e.ctrlKey === true) {
            textarea.removeEventListener("keydown", thisFun);
            done(textarea.value);
            textarea.remove();
          }
        }, false);
        document.body.insertBefore(textarea, document.body.firstChild);
        canceller = function () { textarea.remove(); };
      }, function () {
        canceller();
      });
    });
  };

  JSH.prototype.textarea = function () {
    return this.toText().then(function (text) {
      var t = document.createElement("textarea");
      t.value = text;
      return t;
    });
  };

  JSH.prototype.img = function (mime) {
    return this.toDataURL(mime && mime.contentType || mime || "").then(function (input) {
      var i = document.createElement("img");
      i.src = input;
      return i;
    });
  };

  JSH.prototype.iframe = function () {
    return this.toDataURL("text/html").then(function (input) {
      var i = document.createElement("iframe");
      i.src = input;
      return i;
    });
  };

  exports.JSH = JSH;
  exports.jsh = jsh = new JSH();

}((function () {
  "use strict";
  /*global window, exports */
  try { return exports; } catch (ignored) { return window; }
}())));
