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


/*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, maxerr: 50 */
/*global define, $ */

define(function (require, exports, module) {
    "use strict";


    // Dependencies
    var Async               = require("utils/Async"),
        ValidationUtils     = require("utils/ValidationUtils"),
        _defaultClientsJSON = require("text!LiveDevelopment/clients.json");


    // State
    var _clients = {},
        ready;

    
    function Client() {

    }

    /** @type {string} Identifier for this client */
    Client.prototype._id = null;

    /** @type {string} Human-readable name of this client */
    Client.prototype._name = null;

    /**
     * Returns the identifier for this client.
     * @return {string} The identifier
     */
    Client.prototype.getId = function () {
        return this._id;
    };
    
    /**
     * Sets the identifier for this client or prints an error to the console.
     * @param {!string} id Identifier for this client, use only letters a-z or digits 0-9, and _ inbetween (e.g. "chrome", "node_js")
     * @return {boolean} Whether the ID was valid and set or not
     */
    Client.prototype._setId = function (id) {
        if (!ValidationUtils.validateNonEmptyString(id, "Client ID")) {
            return false;
        }
        // Make sure the ID is a string that can safely be used universally by the computer - as a file name, as an object key, as part of a URL, etc.
        // Hence we use "_" instead of "." since the latter often has special meaning
        if (!id.match(/^[a-z0-9]+(_[a-z0-9]+)*$/)) {
            console.error("Invalid client ID \"" + id + "\": Only groups of lower case letters and numbers are allowed, separated by underscores.");
            return false;
        }
        
        this._id = id;
        return true;
    };

    /**
     * Returns the human-readable name of this client.
     * @return {string} The name
     */
    Client.prototype.getName = function () {
        return this._name;
    };
    
    /**
     * Sets the human-readable name of this client or prints an error to the console.
     * @param {!string} name Human-readable name of the client, as it's commonly referred to (i.e. "Google Chrome")
     * @return {boolean} Whether the name was valid and set or not
     */
    Client.prototype._setName = function (name) {
        if (!ValidationUtils.validateNonEmptyString(name, "name")) {
            return false;
        }
        
        this._name = name;
        return true;
    };

    // Load the default clients
    _defaultClientsJSON = JSON.parse(_defaultClientsJSON);
    ready = Async.doInParallel(Object.keys(_defaultClientsJSON), function (key) {
        return defineClient(key, _defaultClientsJSON[key]);
    }, false);


    function defineClient(id, definition) {
        var result = new $.Deferred();

        var client = new Client(),
            name   = definition.name;
        
        if (!client._setId(id) || !client._setName(name)) {
            result.reject();
        } else {
            result.resolve(client);
        }
        
        return result.promise();
    }

    exports.ready        = ready;
    exports.defineClient = defineClient;
});