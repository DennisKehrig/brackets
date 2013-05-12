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
/*global define, brackets, $ */

define(function (require, exports, module) {
    "use strict";

    var DocumentManager      = brackets.getModule("document/DocumentManager"),
        LiveDevServerManager = brackets.getModule("LiveDevelopment/LiveDevServerManager"),
        ProjectManager       = brackets.getModule("project/ProjectManager"),
        AppInit              = brackets.getModule("utils/AppInit");

    var _ready,
        _serverProvider;

    function onRequest(event, request) {
        var location = request.location,
            path     = location.root.replace(/\/+$/, "") + location.pathname;

        DocumentManager.getDocumentForPath(path).done(function (doc) {
            // Serve document from memory, but prevent conflicts with HTML instrumentation
            if (doc && doc.getLanguage().getId() !== "html") {
                // console.log(path, "served from memory");
                request.send({ body: doc.getText() });
            }
        });
    }

    function urlForPath(path) {
        return _serverProvider.getBaseUrl() + ProjectManager.makeProjectRelativeIfPossible(path);
    }

    function pathForUrl(url) {
        var baseUrl     = _serverProvider.getBaseUrl(),
            projectRoot = ProjectManager.getProjectRoot();
        if (!projectRoot || url.slice(0, baseUrl.length) !== baseUrl) {
            return null;
        }

        return projectRoot.fullPath + url.slice(baseUrl.length);
    }

    function registerFilterForFiles(files) {
        var relativePaths = files.map(function (path) {
            return "/" + ProjectManager.makeProjectRelativeIfPossible(path);
        });

        _serverProvider.setRequestFilterPaths(relativePaths);
    }

    _ready = new $.Deferred();

    // Wait for the static server extension to load
    AppInit.appReady(function () {
        var staticServer = brackets.libRequire.s.contexts.StaticServer.defined.main;
        _serverProvider  = staticServer._getStaticServerProvider();

        function onProviderReady() {
            $(_serverProvider).off(".lesssupport");
            $(_serverProvider).on("request.lesssupport", onRequest);

            console.log("@Provider");
            _ready.resolve();
        }
        
        function startOver() {
            setTimeout(tryUntilReady, 50);
        }
        
        function tryUntilReady() {
            _serverProvider.readyToServe().then(onProviderReady, startOver);
        }

        tryUntilReady();
    });

    exports.ready                  = _ready.promise();
    exports.urlForPath             = urlForPath;
    exports.pathForUrl             = pathForUrl;
    exports.registerFilterForFiles = registerFilterForFiles;
});
