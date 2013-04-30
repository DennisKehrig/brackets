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
/*global define */

/**
 * Functions for validating variables
 */

define(function (require, exports, module) {
    "use strict";
    
    /**
     * Checks whether value is a non-empty string. Reports an error otherwise.
     * If no deferred is passed, console.error is called.
     * Otherwise the deferred is rejected with the error message.
     * @param {*}                value         The value to validate
     * @param {!string}          description   A helpful identifier for value
     * @param {?jQuery.Deferred} deferred      A deferred to reject with the error message in case of an error
     * @return {boolean} True if the value is a non-empty string, false otherwise
     */
    function validateNonEmptyString(value, description, deferred) {
        var reportError = deferred ? deferred.reject : console.error;
        
        // http://stackoverflow.com/questions/1303646/check-whether-variable-is-number-or-string-in-javascript
        if (Object.prototype.toString.call(value) !== "[object String]") {
            reportError(description + " must be a string");
            return false;
        }
        if (value === "") {
            reportError(description + " must not be empty");
            return false;
        }
        return true;
    }
    
    exports.validateNonEmptyString = validateNonEmptyString;
});
