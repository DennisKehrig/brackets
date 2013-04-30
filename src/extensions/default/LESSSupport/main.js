/*
 * Copyright (c) 2012 Adobe Systems Incorporated. All rights reserved.
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
/*global define, brackets, $, less */

define(function (require, exports, module) {
    "use strict";
    
    var DocumentManager      = brackets.getModule("document/DocumentManager"),
        LanguageManager      = brackets.getModule("language/LanguageManager"),
        DOMAgent             = brackets.getModule("LiveDevelopment/Agents/DOMAgent"),
        Inspector            = brackets.getModule("LiveDevelopment/Inspector/Inspector"),
        LiveDevServerManager = brackets.getModule("LiveDevelopment/LiveDevServerManager"),
        FileIndexManager     = brackets.getModule("project/FileIndexManager"),
        ProjectManager       = brackets.getModule("project/ProjectManager"),
        AppInit              = brackets.getModule("utils/AppInit"),
        ExtensionUtils       = brackets.getModule("utils/ExtensionUtils"),
        StringUtils          = brackets.getModule("utils/StringUtils");

    var _less,
        _serverProvider,
        _projectFiles = {};

    // Brackets ships with LESS 1.3.0
    // LESS 1.3.0 insist on loading everything synchronously if the main document (Brackets' index.html) is local
    // LESS 1.3.1 makes this configurable, but doesn't work with Brackets
    // (syntax error in bootstrap's forms.html, then rendering issues with CodeMirror as soon as a file is open)
    // We need to load asynchronously to avoid a deadlock (Brackets waiting for Node, Node waiting for Brackets)
    function loadLess() {
        var result = new $.Deferred();

        var url = ExtensionUtils.getModuleUrl(module, "less_loader_iframe.html");
        $("<iframe>").attr("src", url).hide().appendTo("body").load(function () {
            result.resolve(this.contentWindow.less);
        });

        return result.promise();
    }

    // Taken from ExtensionUtils, not used ATM
    /**
     * Parses LESS code and returns a promise that resolves with plain CSS code.
     *
     * Pass the {@link url} argument to resolve relative URLs contained in the code.
     * Make sure URLs in the code are wrapped in quotes, like so:
     *     background-image: url("image.png");
     *
     * @param {!string} code LESS code to parse
     * @param {?string} url URL to the file containing the code
     * @return {!$.Promise} A promise object that is resolved with CSS code if the LESS code can be parsed
     */
    function parseLessCode(code, url) {
        var result = new $.Deferred(),
            options;
        
        if (url) {
            options = {
                filename: file,
                paths:    [dir]
            };
        }

        var parser = new less.Parser(options);
        parser.parse(code, function onParse(err, tree) {
            if (err) {
                result.reject(err);
            } else {
                result.resolve(tree.toCSS());
            }
        });
        
        return result.promise();
    }
    
    LanguageManager.defineLanguage("less", {
        name: "LESS",
        mode: "less",
        fileExtensions: ["less"],
        blockComment: ["/*", "*/"],
        lineComment: ["//"]
    }).done(function (language) {
        language.addCompiler("css", compileLessToCss);
    });

    function compileLessToCss (url) {
        // return parseLessCode(doc.getText(), doc.file.fullPath);
        var deferred = new $.Deferred();

        // Todo: reject in case of error
        $.get(url, function (lessCode, status, xhr) {
            var date = xhr.getResponseHeader("Last-Modified") || xhr.getResponseHeader("Date");
            if (date) {
                date = new Date(date);
            } else {
                date = new Date();
            }

            var dir       = url.slice(0, url.lastIndexOf("/") + 1),
                file      = url.slice(dir.length),
                async     = _less.async,
                fileAsync = _less.fileAsync;

            // By default, LESS uses synchronous XMLHttpRequests
            // This means Brackets is blocked until the server returns the result
            // However, the node server first calls Brackets for doc.getText()
            // This results in a deadlock, only resolved by the 5s timeout in the node server
            // Luckily, LESS has a setting for that.
            _less.async     = true;
            _less.fileAsync = true;

            var parser = new _less.Parser({ filename: file, paths: [dir], async: true });
            parser.parse(lessCode, function onParse(err, tree) {
                // console.log("Tree", tree);
                var cssCode = tree.toCSS();
                // Restore the previous setting
                // Note that it's possible that other code read our setting (true) in the meantime
                // and "restores" it after we're done.
                _less.async     = async;
                _less.fileAsync = fileAsync;
                
                if (err) {
                    deferred.resolve(err);
                    return;
                }
                
                var mainFile = {
                    url:          url.replace(/[^\.]*$/, "css"),
                    lastModified: date,
                    content:      cssCode,
                };
                
                deferred.resolve({
                    files: [mainFile],
                    mainFile: mainFile
                });
            });
        });

        return deferred.promise();
    }

    function findFileChangesInProject() {
        var result = new $.Deferred();

        FileIndexManager.getFileInfoList("all").done(function (currentFiles) {
            var i,
                path,
                removedFiles  = [],
                addedFiles    = [],
                previousFiles = Object.keys(_projectFiles);

            // Reduce objects to paths
            currentFiles = currentFiles.map(function (file) { return file.fullPath });
            // Keep only LESS files
            currentFiles = currentFiles.filter(function (path) { return LanguageManager.getLanguageForPath(path).getId() === "less"; });

            for (i = 0; i < previousFiles.length; i++) {
                var path = previousFiles[i];
                if (currentFiles.indexOf(path) === -1) {
                    removedFiles.push(path);
                }
            }

            for (i = 0; i < currentFiles.length; i++) {
                var path = currentFiles[i];
                if (previousFiles.indexOf(path) === -1) {
                    addedFiles.push(path);
                }
            }

            result.resolve(addedFiles, removedFiles);
        });

        return result.promise();
    }

    function onRequest(event, request) {
        var location = request.location,
            path     = location.root.replace(/\/+$/, "") + location.pathname,
            context  = _projectFiles[path];

        // Ignore requests to non-LESS files
        if (!context) {
            return;
        }

        var doc = context.document,
            suffix;
        if (doc) {
            suffix = "\nbody:before { content: \"UNSAVED VERSION " + (new Date().getTime()) + "\"; position: fixed; right: 0; top: 10px; display: inline-block; border-radius: 100px 0 0 100px; padding: 5px 10px; background-color: #fc0; font-family: sans-serif; font-size: 10px; letter-spacing: 1px; color: #000; box-shadow: 0 2px 10px #333; font-weight: bold; }";
            request.send({ body: doc.getText() + suffix });
        } else {
            console.log("No document found for", path);
            request.send({ body: "// Document " + path + " not found" });
        }
    }

    // Taken from less.js
    function extractId(href) {
        return href.replace(/^[a-z]+:\/\/?[^\/]+/, '' )  // Remove protocol & domain
                   .replace(/^\//,                 '' )  // Remove root /
                   .replace(/\.[a-zA-Z]+$/,        '' )  // Remove simple extension
                   .replace(/[^\.\w-]+/g,          '-')  // Replace illegal characters
                   .replace(/\./g,                 ':'); // Replace dots with colons(for valid id)
    }

    function onDocumentChanged(e, doc, changes) {
        console.log("Doc changed", doc.file.fullPath);
        var compiler = doc.getLanguage().getCompilerToLanguage("css");
        if (!compiler || !Inspector.connected()) {
            return;
        }

        var context = _projectFiles[doc.file.fullPath];

        if (context.compiling) {
            // Tell the compiler to discard its result and start over
            context.recompile = true;
            return;
        }
        
        var compile = function () {
            console.log("Starting compilation");
            var url = _serverProvider.getBaseUrl() + ProjectManager.makeProjectRelativeIfPossible(doc.file.fullPath);
            compiler(url).always(function (result) {
                if (context.recompile) {
                    context.recompile = false;
                    compile();
                    return;
                }
                context.compiling = false;

                console.log("Compilation", this.state(), result);
                if (this.state() !== "resolved") {
                    return;
                }

                update(url, result.mainFile.content);
            });
        }

        context.compiling = true;
        compile();
    }

    function update(url, content) {
        console.log("Updating");

        // linkNodeId:       Inspector's ID for the <link> node
        // styleIdAttribute: the value of the <style> node's id attribute
        passStyleIdAttribute(url, function (styleIdAttribute) {
            passStyleNodeId(styleIdAttribute, function (styleNodeId) {
                var html = [
                    "<style type=\"text/css\" id=\"",
                    StringUtils.htmlEscape(styleIdAttribute),
                    "\">",
                    content,
                    "</style>"
                ].join("");
                Inspector.DOM.setOuterHTML(styleNodeId, html, function () {
                    console.log("Successfully updated", url);
                });
            });
        })
    }

    function passStyleIdAttribute(url, callback) {
        // Find all links to LESS files
        Inspector.DOM.querySelectorAll(DOMAgent.root.nodeId, "link[rel=\"stylesheet/less\"]", function (res) {
            // Iterate over all LESS <link> nodes
            res.nodeIds.forEach(function (nodeId) {
                // To identify the style tag generated for this link, we need to determine the complete URL and the title
                // We could use Inspector.DOM.getAttributes, but this would only retrieve a relative URL in most cases
                // Instead we use the JavaScript object's href property which contains the complete URL
                
                // Get the JavaScript object for each <link>
                Inspector.DOM.resolveNode(nodeId, function (res) {
                    var objectId = res.object.objectId;
                    // Get the object's properties
                    Inspector.Runtime.getProperties(objectId, function (res) {
                        // Extract the href and title properties
                        var href = null;
                        var title = null;
                        
                        var properties = res.result;
                        for (var i = 0; i < properties.length; i++) {
                            var property = properties[i];
                            if (property.name === "href") {
                                href = property.value.value;
                            }
                            else if (property.name === "title") {
                                title = property.value.value;
                            }
                            else {
                                continue;
                            }
                            
                            if (href !== null && title !== null) {
                                break;
                            }
                        }
                        
                        if (href === url) {
                            callback("less:" + (title || extractId(href)));
                        }
                    });
                });
            });
        });
    };

    function passStyleNodeId(styleIdAttribute, callback) {
        Inspector.DOM.querySelectorAll(DOMAgent.root.nodeId, "style[id=\"" + styleIdAttribute.replace(/"/g, "\\\"") + "\"]", function (res) {
            if (!res.nodeIds) {
                console.warn("Did not find a style tag with ID", styleIdAttribute);
                return;
            }
            if (res.nodeIds.length > 1) {
                console.warn("Found more than one style tag with ID", styleIdAttribute);
            }

            callback(res.nodeIds[0]);
            // Inspector.DOM.getOuterHTML(nodeId, function (res) {
            //     var htmlPrefix = res.outerHTML;
            //     htmlPrefix = htmlPrefix.slice(0, htmlPrefix.indexOf(">") + 1);
            // });
        });
    }
    
    function addDocumentToContext(doc) {
        var context = _projectFiles[doc.file.fullPath];
        context.document = doc;
        doc.addRef();
        $(doc).on("change", onDocumentChanged);
    };

    function rememberFile(path) {
        var context      = _projectFiles[path] = {},
            relativePath = "/" + ProjectManager.makeProjectRelativeIfPossible(path);

        // Make sure only one compilation happens at a time
        context.compiling = false;
        // Note if the document has changed before the compiler finished
        context.recompile = false;
        
        DocumentManager.getDocumentForPath(path).done(addDocumentToContext);
        _serverProvider.setRequestFilterPaths([relativePath]);
    }

    function forgetFile(path) {
        var context = _projectFiles[path],
            doc     = context.document;
        
        if (doc) {
            $(doc).off("change", onDocumentChanged);
            doc.releaseRef();
        }

        clearTimeout(context.compilationTimeout);
        
        delete _projectFiles[path];
    }

    function registerFilterForNewFilesInProject() {
        findFileChangesInProject().done(function (addedFiles, removedFiles) {
            var i, path, doc, relativePaths;

            for (i = 0; i < removedFiles.length; i++) {
                forgetFile(removedFiles[i]);
            }
            for (i = 0; i < addedFiles.length; i++) {
                rememberFile(addedFiles[i]);
            }
        });
    }

    function onProviderReady(provider) {
        console.log("Provider ready!");

        $(provider).off(".lesssupport");
        $(provider).on("request.lesssupport", onRequest);

        _serverProvider = provider;

        registerFilterForNewFilesInProject();
        $(ProjectManager).on("projectOpen projectFilesChange", registerFilterForNewFilesInProject);
    }

    // *   `connect`    Inspector did successfully connect to the remote debugger
    // *   `disconnect` Inspector did disconnect from the remote debugger

    // function onInspectorConnect() {

    // }

    // $(Inspector).on("connect", onInspectorConnect);
    // $(Inspector).on("disconnect", onInspectorDisconnect);
 

    AppInit.appReady(function () {
        loadLess().done(function (less) {
            _less = less;
            console.log("LESS loaded");
            
            var staticServerExtension = brackets.libRequire.s.contexts["StaticServer"].defined.main;
            var provider = staticServerExtension._getStaticServerProvider();

            var tryUntilReady = function () {
                var promise = provider.readyToServe();
                promise.then(
                    function () {
                        onProviderReady(provider);
                    },
                    function () {
                        setTimeout(tryUntilReady, 50);
                    }
                );
            };

            tryUntilReady();
        });
    });
});
