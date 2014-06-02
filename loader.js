define(function(require, exports) {
  "use strict";

  var $ = require("jquery");
  var routeMatcher = require("javascript-route-matcher");

  // Plugin defaults, can be overwritten.
  var defaults = {
    /**
     * Test if a route is valid.
     *
     * @private
     * @param {string} route - The template URL.
     * @param {string} url - The URL to be tested.
     * @return {boolean} Whether or not hte url matches the route template.
     */
    testRoute: function(route, url) {
      return Boolean(route.parse(url.split("?")[0]));
    },

    // Set 404 timeout to simulate real-world delay.
    delay: {
      404: 100
    },

    // Allow AJAX requests to pass through.
    passthrough: true
  };

  // Cache internally all future defined routes.
  var _routes = {};

  /**
   * Adding transports in jQuery will push them to the end of the stack for
   * filtering.  Without the + preceding the wildcard *, most requests would
   * still be handled by jQuery's internal transports.  With the +, this
   * catch-all transport is bumped to the front and hijacks *ALL* requests.
   */
  $.ajaxTransport("+*", function(options, originalOptions, jqXHR) {
    var timeout, captures, match, route, template;
    var method = options.type.toUpperCase();

    // Detect method to check if a route is found match will either be
    // undefined (falsy) or true (truthy).
    $.each(_routes, function(key, val) {
      template = routeMatcher(key);
      captures = defaults.testRoute(template, options.url);
      route = _routes[key];

      // Capture has been found, ensure the requested type has a handler
      if (captures && route[method]) {
        match = true;

        // Break the jQuery.each loop
        return false;
      }
    });

    // If no matches were found, instead of triggering a fake 404, attempt
    // to use real AJAX
    if (!match && defaults.passthrough) {
      return null;
    }

    // Per the documentation a transport should return an object
    // with two keys: send and abort.
    //
    // send: Passes the currently requested route through the routes
    // object and attempts to find a match.
    return {
      send: function(headers, completeCallback) {
        var context;

        // If no matches, trigger 404 with delay
        if (!match) {
          // Return to ensure that the successful handler is never run
          return timeout = window.setTimeout(function() {
            completeCallback(404, "error");
          }, defaults.delay["404"]);
        }

        // Ensure captures is an array and not null
        captures = captures || [];

        // Set the context to contain references to the mocks instance and
        // the jqXHR object.
        context = {
          jqXHR: jqXHR,
          qs: options.data || options.url.split("?")[1] || "",
          params: template.parse(options.url.split("?")[0] || ""),
          promise: new $.Deferred()
        };

        // Slice off the path from captures, only want to send the arguments.
        // Capture the return value.
        route[method].apply(context, [options.url]);

        // Wait for the promise to resolve before continuing.
        context.promise.always(function(code, data) {
          // A timeout is useful for testing behavior that may require an
          // abort or simulating how slow requests will show up to an end
          // user.
          timeout = window.setTimeout(function() {
            completeCallback(code || 200, "success", {
              responseText: JSON.stringify(data)
            });
          }, route.timeout || 0);
        });
      },

      // This method will cancel any pending "request", by clearing the
      // timeout that is responsible for triggering the success callback.
      abort: function() {
        window.clearTimeout(timeout);
      }
    };
  });

  exports.load = function(name, req, load, config) {
    var options = config.mock || {};

    // If we're in a build, bail out.
    if (config.isBuild) {
      return load();
    }

    // Assign defaults.
    options.__proto__ = defaults;

    // Require the mock request handlers.
    require([name + "/handlers"], function(handlers) {
      // Set up the data.
      Object.keys(handlers).forEach(function(endpoint) {
        _routes[endpoint] = handlers[endpoint];
      });

      load(handlers);
    });
  };
});
