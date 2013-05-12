/*
 * Copyright (c) 2013 Adobe Systems Incorporated. All rights reserved.
 *  
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"), 
 * to deal in the Software without restriction, including without limitation 
 * the rights to use, copy, modify, merge, publish, distribute, sublicense, 
 * and/or sell copies of the Software, and to permit persons to whom the 
 * Software is furnished to do so, subject to the following conditions:
 *  
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *  
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, 
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER 
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING 
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER 
 * DEALINGS IN THE SOFTWARE.
 * 
 */


/*jslint vars: true, plusplus: true, nomen: true, regexp: true, maxerr: 50 */
/*global define, brackets, console, $, PathUtils */

define(function (require, exports, module) {
    "use strict";

    var ExtensionUtils = brackets.getModule("utils/ExtensionUtils");

    var _less,
        _ready,
        // Time in ms to wait for the compilation to finish - will fire for missing @imported files
        _COMPILER_TIMEOUT = 1000;

    // Brackets ships with LESS 1.3.0
    // LESS 1.3.0 insists on loading everything synchronously if the main document (Brackets' index.html) is local
    // LESS 1.3.1 makes this configurable, but doesn't work with Brackets
    // (syntax error in bootstrap's forms.html, then rendering issues with CodeMirror as soon as a file is open)
    // We need to load asynchronously to avoid a deadlock (Brackets waiting for Node, Node waiting for Brackets)
    function _loadLess() {
        var result = new $.Deferred();

        var url = ExtensionUtils.getModuleUrl(module, "less_loader_iframe.html");
        $("<iframe>").attr("src", url).hide().appendTo("body").load(function () {
            result.resolve(this.contentWindow.less);
        });

        return result.promise();
    }

    function _findImports(tree, url) {
        var i,
            rule,
            rules   = tree.rules,
            imports = [];

        for (i = 0; i < rules.length; i++) {
            rule = rules[i];
            // If this is an import...
            if (rule.path && rule.root) {
                // Todo: test other cases (import of absolute URL, import of CSS file, import via @import url(...), etc.)
                imports.push(PathUtils.makeUrlAbsolute(rule.path, url));
            }
        }

        return imports;
    }

    function analyze(contents, url) {
        var result  = new $.Deferred(),
            dir     = url.slice(0, url.lastIndexOf("/") + 1),
            options,
            parser,
            timeout;

        function onError() {
            console.warn("Error when compiling", url, arguments);
            clearTimeout(timeout);
            timeout = null;
            result.reject("error", arguments);
        }

        function onTimeout() {
            // Set the timeout to null so onParse can detect it occured
            console.warn("Timeout when compiling", url);
            timeout = null;
            result.reject("timeout");
        }

        function onParse(err, tree) {
            // Already timed out => abort instead of rejecting again
            if (!timeout) {
                return;
            }
            clearTimeout(timeout);

            if (err) {
                result.reject(err);
                return;
            }

            var imports = _findImports(tree, url);

            result.resolve({
                parseTree:    tree,
                importedUrls: imports
            });
        }

        timeout = setTimeout(onTimeout, _COMPILER_TIMEOUT);
        options = {
            filename:  url,
            // Various options that LESS also passes to the compiler when it discovers the <link> tags
            // Leaving some of them out can cause issues with relative references like url(...)
            // in imported files
            entryPath: dir,
            rootpath:  dir,
            paths:     [dir],
            errback:   onError
        };
        parser = new _less.Parser(options);
        parser.parse(contents, onParse);

        return result.promise();
    }

    _ready = new $.Deferred();

    _loadLess().done(function (less) {
        _less = less;
        
        // By default, LESS uses synchronous XMLHttpRequests.
        // This means Brackets is blocked until the server returns the result.
        // However, to access the unsaved content of files, the node server calls Brackets.
        // This results in a deadlock, only resolved by the 5s timeout in the node server.
        // Luckily, LESS has a setting for that.
        _less.async     = true;
        // This setting has been added in LESS 1.3.1
        // Since Brackets is loaded from a file URL, it is the most important one.
        _less.fileAsync = true;

        console.log("@Analyzer");
        _ready.resolve();
    });

    exports.ready   = _ready.promise();
    exports.analyze = analyze;
});
