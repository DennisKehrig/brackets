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


/**
 * The tracker maintains context objects for all documents in the project.
 * Part of the context objects are the keys "referencesTo" and "referencedBy",
 * modeling relationships between documents. This is needed to update a
 * master file if an included file is changed.
 * The tracker also detects if a file is changed and calls compilers and updaters
 * as is appropriate.
 */

/*jslint vars: true, plusplus: true, nomen: true, regexp: true, maxerr: 50 */
/*global define, brackets, console, $ */

define(function (require, exports, module) {
    "use strict";

    var provider = require("provider");

    var DocumentManager  = brackets.getModule("document/DocumentManager"),
        ClientManager    = brackets.getModule("LiveDevelopment/ClientManager"),
        FileIndexManager = brackets.getModule("project/FileIndexManager"),
        ProjectManager   = brackets.getModule("project/ProjectManager"),
        AppInit          = brackets.getModule("utils/AppInit"),
        Async            = brackets.getModule("utils/Async");

    var _projectFiles = {};

    function _analyzeDocument(doc) {
        var result = new $.Deferred();

        var previousAnalysisReady = doc.analysisReady;
        // Leave this for other content change handlers that are interested in the analysis
        doc.analysisReady = result.promise();

        function performAnalysis() {
            // console.log("Performing analysis");
            var analysis  = {},
                language  = doc.getLanguage(),
                analyzers = language.getAnalyzers(),
                path      = doc.file.fullPath,
                context   = _projectFiles[path];

            function addResult(result) {
                $.extend(analysis, result);
            }

            var ready = Async.doInParallel(analyzers, function (analyzer) {
                var result = new $.Deferred();

                try {
                    analyzer.analyze(doc.getText(), provider.urlForPath(path))
                        .done(addResult)
                        .then(result.resolve, result.reject);
                } catch(e) {
                    console.error("An exception occured when running an analyzer:", e);
                    result.reject(e);
                }

                return result.promise();
            }, false);

            ready
                .fail(result.reject)
                .done(function () {
                    // Fill context.referencesTo by interpreting analysis.importedUrls
                    // Based on this, maintain context.referencedBy for the referenced files

                    var previousReferencesTo = context.referencesTo;
                    context.referencesTo = {};

                    (analysis.importedUrls || []).forEach(function (url) {

                        var inputPath    = provider.pathForUrl(url),
                            inputContext = _projectFiles[inputPath];

                        if (inputContext) {
                            context.referencesTo[inputPath] = true;
                            inputContext.referencedBy[path] = true;
                            if (previousReferencesTo[inputPath]) {
                                delete previousReferencesTo[inputPath];
                            }
                        }
                    });

                    Object.keys(previousReferencesTo).forEach(function (inputPath) {
                        var inputContext = _projectFiles[inputPath];
                        if (inputContext) {
                            delete inputContext.referencedBy[path];
                        }
                    });

                    result.resolve(analysis);
                });
        }

        if (!previousAnalysisReady) {
            performAnalysis();
        } else {
            previousAnalysisReady.always(performAnalysis);
        }

        return result.promise();
    }

    function _updateDocument(doc) {
        var sessions = ClientManager.getSessions();
        // No Live Development sessions? No update.
        if (!sessions) {
            return;
        }

        var context = _projectFiles[doc.file.fullPath];

        function performUpdate() {
            context.updateInProgress = true;
            
            var updateDone = Async.doInParallel(sessions, function (session) {
                var updaters = session.client.getUpdatersForLanguage(doc.getLanguage());
                return Async.doInParallel(updaters, function (updater) {
                    var result = new $.Deferred();

                    // console.log("Updating", doc.file.fullPath, "in", session.client.getName());
                    try {
                        updater.update(doc, session).then(result.resolve, result.reject);
                    } catch(e) {
                        console.error("An exception occured during an update:", e);
                        result.reject(e);
                    }

                    return result.promise();
                }, false);
            }, false);

            updateDone.always(function () {
                // Another edit has occured in the meantime => start over
                if (context.discardCurrentUpdate) {
                    // console.log("Update repeating");
                    context.discardCurrentUpdate = false;
                    performUpdate();
                } else {
                    // console.log("Update complete");
                    context.updateInProgress = false;
                }
            });
        }
        
        if (!context.updateInProgress) {
            // console.log("Update starting");
            performUpdate();
        } else {
            // console.log("Update deferred");
            context.discardCurrentUpdate = true;
        }
    }

    function _getAffectedFiles(path) {
        var context,
            affectedFiles = {},
            queue         = [path];

        // Determine all files that directly or indirectly depend on the document
        while (queue.length > 0) {
            path = queue.shift();
            // Prevent infinite loops due to circular dependencies
            if (affectedFiles[path]) { continue; }
            affectedFiles[path] = true;

            context = _projectFiles[path];
            queue.push.apply(queue, Object.keys(context.referencedBy));
        }

        return Object.keys(affectedFiles);
    }

    function onDocumentChanged(e, doc, changes) {
        var affectedFiles,
            analysisReady;

        affectedFiles = _getAffectedFiles(doc.file.fullPath);

        analysisReady = Async.doInParallel(affectedFiles, function (path) {
            var result = new $.Deferred();

            DocumentManager.getDocumentForPath(path)
                .fail(result.reject)
                .done(function (doc) {
                    _analyzeDocument(doc).then(result.resolve, result.reject);
                });
            
            return result.promise();
        }, false);

        analysisReady.always(function () {
            // The list of affected files might have changed due to the document change -> refresh
            affectedFiles = _getAffectedFiles(doc.file.fullPath);
            affectedFiles.forEach(function (path) {
                DocumentManager.getDocumentForPath(path).done(function (doc) {
                    _updateDocument(doc);
                });
            });
        });
    }

    function _findFileChangesInProject() {
        var result = new $.Deferred();

        FileIndexManager.getFileInfoList("all").done(function (currentFiles) {
            var i,
                path,
                removedFiles  = [],
                addedFiles    = [],
                previousFiles = Object.keys(_projectFiles);

            // Reduce objects to paths
            currentFiles = currentFiles.map(function (file) {
                return file.fullPath;
            });

            for (i = 0; i < previousFiles.length; i++) {
                path = previousFiles[i];
                if (currentFiles.indexOf(path) === -1) {
                    removedFiles.push(path);
                }
            }

            for (i = 0; i < currentFiles.length; i++) {
                path = currentFiles[i];
                if (previousFiles.indexOf(path) === -1) {
                    addedFiles.push(path);
                }
            }

            result.resolve(addedFiles, removedFiles);
        });

        return result.promise();
    }

    function _rememberFile(path, doc) {
        var context = _projectFiles[path] = {};

        // Make sure only one compilation happens at a time
        context.compilerDeferred = null;
        // Note if the document has changed before the compiler finished
        context.recompile = false;

        // path => Boolean (true for files that reference this file)
        context.referencedBy = {};
        // path => Boolean (true for files that this file references)
        context.referencesTo = {};
        
        context.document = doc;
        doc.addRef();
        $(doc).on("change", onDocumentChanged);
    }

    function _forgetFile(path) {
        var context = _projectFiles[path],
            doc     = context.document;
        
        if (doc) {
            $(doc).off("change", onDocumentChanged);
            doc.releaseRef();
        }

        clearTimeout(context.compilationTimeout);
        
        delete _projectFiles[path];
    }

    function _registerFilterForNewFilesInProject() {
        _findFileChangesInProject().done(function (addedFiles, removedFiles) {
            removedFiles.forEach(_forgetFile);

            var pending   = addedFiles.length,
                paths     = [],
                documents = [],
                documentsReady;

            documentsReady = Async.doInParallel(addedFiles, function (path) {
                // This will fail for images
                return DocumentManager.getDocumentForPath(path)
                    .done(function (doc) {
                        _rememberFile(path, doc);
                        paths.push(path);
                        documents.push(doc);
                    });
            }, false);

            documentsReady.always(function () {
                provider.registerFilterForFiles(paths);
                // Do an initial compilation to track references
                // This allows us to update main.less if the imported shared.less is modified
                documents.forEach(_analyzeDocument);
            });
        });
    }

    function onProviderReady() {
        _registerFilterForNewFilesInProject();
        $(ProjectManager).on("projectOpen projectFilesChange", _registerFilterForNewFilesInProject);

        console.log("@Tracker");
    }

    function contextForPath(path) {
        return _projectFiles[path];
    }

    // Wait for the project to finish loading
    AppInit.appReady(function () {
        provider.ready.done(onProviderReady);
    });

    exports.contextForPath = contextForPath;
});