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

  var resolve = function (v) {
    return new Promise(function (r) {
      r(v);
    });
  }, reject = function (v) {
    return new Promise(function (_, r) {
      /*jslint unparam: true */
      r(v);
    });
  }, resolved = resolve();

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
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function (ev) { return resolve(ev.target.result); };
      fr.onerror = function () { return reject(new Error("Unable to read blob as text")); };
      fr.readAsText(blob);
    });
  }

  function readBlobAsArrayBuffer(blob) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function (ev) { return resolve(ev.target.result); };
      fr.onerror = function () { return reject(new Error("Unable to read blob as ArrayBuffer")); };
      fr.readAsArrayBuffer(blob);
    });
  }

  function readBlobAsBinaryString(blob) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function (ev) { return resolve(ev.target.result); };
      fr.onerror = function () { return reject(new Error("Unable to read blob as binary string")); };
      fr.readAsBinaryString(blob);
    });
  }

  function promiseBasedWhile(tester, loop) {
    return new Promise(function (done, fail) {
      function recWithLoop() {
        resolved.then(tester).then(function (result) {
          if (result) {
            return resolved.then(loop).then(recWithLoop);
          }
          done();
        }).then(null, fail);
      }
      function recWithoutLoop() {
        resolved.then(tester).then(function (result) {
          if (result) { return recWithoutLoop(); }
          done();
        }).then(null, fail);
      }
      if (typeof loop === "function") {
        recWithLoop();
      } else {
        recWithoutLoop();
      }
    });
  }

  function toThenable(v) {
    if (v && typeof v.then === "function") { return v; }
    return {then: function (done) {
      return toThenable(done(v));
    }};
  }


  function JSH(value) {
    this._value = value;
    this.promise = new Promise(function (r) { r(value); });
  }

  JSH.prototype.promise = null;

  JSH.prototype.then = function (a, b) {
    return new JSH(this.promise.then(a, b));
  };

  JSH.prototype.catch = function (b) {
    return new JSH(this.promise.then(null, b));
  };

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
  };

  JSH.prototype.value = function (value) {
    return this.then(function () {
      return value;
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

  JSH.prototype.asBlob = function () {
    // TODO if input === undefined, return undefined too ?
    var it = this;
    return it.then(function (input) {
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

  JSH.prototype.asText = function () {
    // TODO if input === undefined, return undefined too ?
    var it = this;
    return it.then(function (input) {
      if (input === undefined || input === null) {
        return toThenable("");
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

  JSH.prototype.asArrayBuffer = function () {
    // TODO if input === undefined, return undefined too ?
    var it = this;
    return it.then(function (input) {
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
        return toThenable("");
      }
      if (typeof input === "string") {
        return input;
      }
      return readBlobAsText(new Blob([input]));
    });
  };

  JSH.prototype.asDataURL = function (contentType) {
    // TODO check contentType with regex?
    // TODO remove /;base64(;|$)/ from contentType?
    return this.base64().then(function (input) {
      return "data:" + contentType + ";base64," + input;
    });
  };

  JSH.prototype.sleep = function (ms) {
    return this.then(function (input) {
      return new Promise(function (done) {
        setTimeout(done, ms, input);
      });
    });
  };

  JSH.prototype.never = function () {
    return this.then(function () {
      return new Promise(function () { return; });
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

  JSH.prototype.forEach = function (callback) {
    return this.then(function (array) {
      if (array.length === 0) { return; }
      var i = 0;
      return promiseBasedWhile(function () {
        return toThenable(callback(array[i], i, array)).then(function () {
          i += 1;
          return i < array.length;
        });
      }).then(function () { return array; });
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
      return promiseBasedWhile(tester, function () {
        return toThenable(callback(start, input)).then(incrementStart);
      });
    });
  };

  JSH.prototype.loop = function (callback) {
    // Infinite loop until fail
    return this.then(function (input) {
      if (typeof callback !== "function") {
        throw new Error("loop: callback is not a function");
      }
      var next = new Promise(function (r) { r(input); });
      return promiseBasedWhile(function () {
        return next.then(callback).then(returnTrue);
      });
    });
  };

  function basicEncoder(encoder) {
    return function (value) {
      var it = this;
      return it.then(function (input) {
        var p;
        if (value !== undefined) { input = value; }
        if (input === undefined || input === null) {
          p = toThenable("");
        } else if (input instanceof Blob) {
          p = readBlobAsBinaryString(input);
        } else if (input instanceof ArrayBuffer) {
          p = toThenable(arrayBufferToBinaryString(input));
        } else if (input.buffer instanceof ArrayBuffer) {
          p = toThenable(arrayBufferToBinaryString(input.buffer));
        } else {
          p = readBlobAsBinaryString(new Blob([input]));
        }
        return p.then(encoder);
      });
    };
  }

  function basicDecoder(decoder) {
    return function (value) {
      // TODO ignore garbage
      return this.then(function (input) {
        if (value !== undefined) { input = value; }
        // should already ignores newlines
        return new Blob([binaryStringToArrayBuffer(decoder(input))]);
      });
    };
  }

  JSH.prototype.base64 = basicEncoder(btoa);
  JSH.prototype.unbase64 = basicDecoder(atob);

  function htoa(binaryString) {
    var r = "", i;
    for (i = 0; i < binaryString.length; i += 1) {
      r += ("0" + binaryString.charCodeAt(i).toString(16)).slice(-2);
    }
    return r;
  }

  function atoh(text) {
    var r = "", i, c;
    text = text.replace(/\s/g, "");
    if (text.length % 2) {
      text += "0";
    }
    for (i = 0; i < text.length; i += 2) {
      c = (parseInt(text[i], 16) * 0x10) + parseInt(text[i + 1], 16);
      if (isNaN(c)) {
        btoa("="); // throws InvalidCharacterError
        throw objectUpdate(new Error("String contains an invalid character"), {"name": "InvalidCharacterError", "code": 5});
      }
      r += String.fromCharCode(c);
    }
    return r;
  }

  JSH.prototype.hex = basicEncoder(htoa);
  JSH.prototype.unhex = basicDecoder(atoh);

  JSH.prototype.wrapLines = function (wrap) {
    // TODO make it cancellable
    if (!(wrap > 0)) {
      return this.asText();
    }
    return this.asText().then(function (text) {
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

  /**
   * Send request with XHR and return a promise. xhr.onload: The promise is
   * resolved when the status code is lower than 400 with the xhr object as first
   * parameter. xhr.onerror: reject with xhr object as first
   * parameter. xhr.onprogress: notifies the xhr object.
   *
   * @param  {Object} param The parameters
   * @param  {String} param.url The url
   * @param  {String} [param.method="GET"] The request method
   * @param  {String} [param.responseType=""] The data type to retrieve
   * @param  {String} [param.overrideMimeType] The mime type to override
   * @param  {Object} [param.headers] The headers to send
   * @param  {Any} [param.data] The data to send
   * @param  {Boolean} [param.withCredentials] Tell the browser to use credentials
   * @param  {Object} [param.xhrFields] The other xhr fields to fill
   * @param  {Function} [param.beforeSend] A function called just before the send
   *   request. The first parameter of this function is the XHR object.
   * @return {Promise} The promise
   */
  JSH.prototype.ajax = function (param, inputKey) {
    return this.then(function (input) {
      if (inputKey === undefined) {
        if (param.data === undefined) {
          param.data = input; // can be disable if param.data = null
        } else if (param.url === undefined && typeof input === "string") {
          param.url = input;
        }
      } else {
        param[inputKey] = input;
      }
      var xhr = new XMLHttpRequest();
      return new Promise(function (done, fail) {
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
          if (e.target.status >= 400) {
            return fail(new Error("request: " + (e.target.statusText || "unknown error")));
          }
          return done(e.target.response);
        }, false);
        xhr.addEventListener("error", function () {
          return fail(new Error("request: error"));
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
      });
    });
  };

  function methodWebdavURI(method, replace1, replace2) {
    return function (uri) {
      return this.then(function (_uri) {
        if (uri === undefined) { _uri = uri; }
        _uri = asString(_uri).replace(replace1, replace2);
        if (param.withCredentials === undefined) { param.withCredentials = true; }
        return input;
      }).ajax(param, inputKey);
    };
  }

  function methodURI(method) {
    return function (uri) {
      var it = this;
      return it.then(function (_uri) {
        if (uri !== undefined) { _uri = uri; }
        var tmp = (/^([a-z]+):/).exec(uri);
        if (tmp) {
          return it[method +
                    tmp[1].slice(0, 1).toUpperCase() + tmp[1].slice(1).toLowerCase() +
                    "URI"](_uri);
        }
        return it.ajax({"url": _uri, "method": method.toUpperCase(), "responseType": "blob"});
      });
    };
  }

  JSH.prototype.getURI = methodURI("get");
  JSH.prototype.putURI = methodURI("put");
  JSH.prototype.deleteURI = methodURI("delete");

  function methodHttpURI(method) {
    return function (uri) {
      var it = this;
      return it.then(function (_uri) {
        if (uri !== undefined) { _uri = uri; }
        return it.ajax({
          "url": _uri,
          "method": method,
          "responseType": "blob",
          "withCredentials": true
        });
      });
    };
  }

  JSH.prototype.getHttpURI = methodHttpURI("GET");
  JSH.prototype.putHttpURI = methodHttpURI("PUT");
  JSH.prototype.deleteHttpURI = methodHttpURI("DELETE");
  JSH.prototype.getHttpsURI = methodHttpURI("GET");
  JSH.prototype.putHttpsURI = methodHttpURI("PUT");
  JSH.prototype.deleteHttpsURI = methodHttpURI("DELETE");

  JSH.prototype.textarea = function () {
    // TODO make this method a kind of window with "ok" and "exit" button (may be with a this.window(...) method)
    // TODO add default value to textarea
    // TODO make it cancellable
    // TODO add option.placeholder
    // TODO add option.windowTitle
    return this.asText().then(function (text) {
      return new Promise(function (done, fail) {
        var textarea = document.createElement("textarea");
        textarea.style.position = "absolute";
        textarea.placeholder = "Press Ctrl+Enter to validate this textarea, or press Escape to invalidate it.";
        if (text !== undefined) { textarea.value = text; }
        textarea.addEventListener("keypress", function thisFun(e) {
          if (e.key === "Esc" || e.key === "Escape") {
            textarea.removeEventListener("keypress", thisFun);
            textarea.remove();
            fail(new Error("textarea() exited"));
          } else if (e.key === "Enter" && e.ctrlKey === true) {
            textarea.removeEventListener("keypress", thisFun);
            done(textarea.value);
            textarea.remove();
          }
        }, false);
        document.body.insertBefore(textarea, document.body.firstChild);
      });
    });
  };

  exports.jsh = new JSH();

}((function () {
  "use strict";
  /*global window, exports */
  try { return exports; } catch (ignored) { return window; }
}())));
