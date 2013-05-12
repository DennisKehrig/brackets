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
/*global define, brackets, console, $ */

define(function (require, exports, module) {
    "use strict";

    var StringUtils = brackets.getModule("utils/StringUtils");

    var analyzer = require("analyzer"),
        provider = require("provider");

    // Taken from less.js
    function _extractId(href) {
        return href.replace(/^[a-z]+:\/\/?[^\/]+/, '' )  // Remove protocol & domain
                   .replace(/^\//,                 '' )  // Remove root /
                   .replace(/\.[a-zA-Z]+$/,        '' )  // Remove simple extension
                   .replace(/[^\.\w-]+/g,          '-')  // Replace illegal characters
                   .replace(/\./g,                 ':'); // Replace dots with colons(for valid id)
    }

    function _findStyleIdAttribute(session, url, callback) {
        // Find all links to LESS files
        session.Inspector.DOM.querySelectorAll(session.agents.dom.root.nodeId, "link[rel=\"stylesheet/less\"]", function (res) {
            if (res.nodeIds.length === 0) {
                callback(null);
                return;
            }

            var pending = res.nodeIds.length,
                found   = false;
            
            // Iterate over all LESS <link> nodes
            res.nodeIds.forEach(function (nodeId) {
                // To identify the style tag generated for this link, we need to determine the complete URL and the title
                // We could use Inspector.DOM.getAttributes, but this would only retrieve a relative URL in most cases
                // Instead we use the JavaScript object's href property which contains the complete URL
                
                // Get the JavaScript object for each <link>
                session.Inspector.DOM.resolveNode(nodeId, function (res) {
                    var objectId = res.object.objectId;
                    // Get the object's properties
                    session.Inspector.Runtime.getProperties(objectId, function (res) {
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

                        pending--;
                        if (href === url) {
                            found = true;
                            callback("less:" + (title || _extractId(href)));
                        }
                        else if (pending === 0 && !found) {
                            callback(null);
                        }
                    });
                });
            });
        });
    }

    function _findStyleNodeId(session, styleIdAttribute, callback) {
        session.Inspector.DOM.querySelectorAll(session.agents.dom.root.nodeId, "style[id=\"" + styleIdAttribute.replace(/"/g, "\\\"") + "\"]", function (res) {
            if (!res.nodeIds) {
                console.warn("Did not find a style tag with ID", styleIdAttribute);
                callback(null);
                return;
            }
            if (res.nodeIds.length > 1) {
                console.warn("Found more than one style tag with ID", styleIdAttribute);
            }

            callback(res.nodeIds[0]);
        });
    }

    function update(doc, session) {
        var result = new $.Deferred(),
            chrome = session.client,
            url    = provider.urlForPath(doc.file.fullPath);

        if (!session.agents.network.wasURLRequested(url)) {
            return result.reject("URL not requested").promise();
        }
        
        // styleIdAttribute: the value of the <style> node's id attribute
        _findStyleIdAttribute(session, url, function (styleIdAttribute) {
            if (!styleIdAttribute) {
                result.reject("Style ID attribute not found");
                return;
            }
            _findStyleNodeId(session, styleIdAttribute, function (styleNodeId) {
                if (!styleNodeId) {
                    result.reject("Style ID node not found");
                    return;
                }

                // analyzer.analyze(doc.getText(), url)
                doc.analysisReady
                    .fail(result.reject)
                    .done(function (analysis) {
                        var html = [
                            "<style type=\"text/css\" id=\"",
                            StringUtils.htmlEscape(styleIdAttribute),
                            "\">",
                            analysis.parseTree.toCSS(),
                            "</style>"
                        ].join("");
                        session.Inspector.DOM.setOuterHTML(styleNodeId, html, function () {
                            result.resolve();
                        });                        
                    });
            });
        });

        
        return result.promise();
    }

    exports.update = update;
});
