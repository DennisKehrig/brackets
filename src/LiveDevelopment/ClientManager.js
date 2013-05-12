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
    var Async           = require("utils/Async"),
        ValidationUtils = require("utils/ValidationUtils");


    // State
    var _clients         = {},
        _promisedClients = {},
        _sessions        = [];

    
    function Client() {
        this._updatersForLanguage = {};
        this._sessionInitializers = [];
    }

    /** @type {string} Identifier for this client */
    Client.prototype._id = null;

    /** @type {string} Human-readable name of this client */
    Client.prototype._name = null;

    Client.prototype._updatersForLanguage = null;

    Client.prototype._sessionInitializers = null;
    
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

    Client.prototype.addUpdaterForLanguage = function (languageId, updater) {
        if (languageId.getId) {
            languageId = languageId.getId();
        }

        var updaters = this._updatersForLanguage[languageId];
        if (!updaters) {
            updaters = this._updatersForLanguage[languageId] = [];
        }
        updaters.push(updater);
    };

    Client.prototype.getUpdatersForLanguage = function (languageId) {
        if (languageId.getId) {
            languageId = languageId.getId();
        }
        // Return a copy
        return (this._updatersForLanguage[languageId] || []).concat();
    };

    Client.prototype.addSessionInitializer = function (initializer) {
        this._sessionInitializers.push(initializer);
    };

    Client.prototype.connect = function () {
        var result  = new $.Deferred(),
            session = { client: this },
            that    = this,
            ready;

        ready = Async.doInParallel(this._sessionInitializers, function (initializer) {
            return initializer.call(that, session);
        }, true);

        ready
            .fail(result.reject)
            .done(function () {
                $(that).triggerHandler("connect", [session]);
                result.resolve(session);
            });

        return result.promise();
    };

    Client.prototype.disconnect = function (session) {
        var result = new $.Deferred();
        
        $(this).triggerHandler("disconnect", [session]);

        return result.resolve().promise();
    };


    function onClientConnect(e, session) {
        _sessions.push(session);
    }

    function onClientDisconnect(e, session) {
        var index = _sessions.indexOf(session);
        if (index > -1) {
            _sessions.splice(index, 1);
        }
    }


    function getClient(id) {
        return _clients[id];
    }

    function createClient(definition) {
        var client = new Client();
        
        if (!client._setName(definition.name)) {
            return;
        }
        
        return client;
    }

    function registerClient(id, client) {
        if (_clients[id]) {
            console.error("There already is a client with the ID " + id);
            return false;
        }
        
        if (!client._setId(id)) {
            return false;
        }

        _clients[id] = client;

        $(client).on("connect", onClientConnect);
        $(client).on("disconnect", onClientDisconnect);

        var deferred = _promisedClients[id];
        if (deferred) {
            delete _promisedClients[id];
            deferred.resolve(client);
        }

        return true;
    }

    function waitUntilClientReady(id) {
        var client = _clients[id];
        if (client) {
            return new $.Deferred().resolve(client).promise();
        }

        var deferred = _promisedClients[id];
        if (!deferred) {
            deferred = _promisedClients[id] = new $.Deferred();
        }
        return deferred.promise();
    }

    function getSessions() {
        // Return a copy
        return _sessions.concat();
    }

    exports.getClient            = getClient;
    exports.createClient         = createClient;
    exports.registerClient       = registerClient;
    exports.waitUntilClientReady = waitUntilClientReady;
    exports.getSessions          = getSessions;
});