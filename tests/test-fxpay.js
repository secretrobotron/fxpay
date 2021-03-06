describe('fxpay', function () {
  var server;

  beforeEach(function() {
    console.log('beginEach');
    server = sinon.fakeServer.create();
  });

  afterEach(function() {
    server.restore();
  });

  describe('purchase()', function () {
    var mozPay;

    beforeEach(function() {
      mozPay = sinon.spy(mozPayStub);
      appSelf.init();
    });

    afterEach(function() {
      mozPay.reset();
      receiptAdd.reset();
    });

    it('should send a JWT to mozPay', function (done) {
      var webpayJWT = '<base64 JWT>';
      var apiUrl = 'https://not-the-real-marketplace';
      var versionPrefix = '/api/v1';

      fxpay.purchase('123', {
        onpurchase: function(err) {
          if (!err) {
            assert.ok(mozPay.called);
            assert.ok(mozPay.calledWith([webpayJWT]), mozPay.firstCall);
          }
          done(err);
        },
        mozPay: mozPay,
        mozApps: mozAppsStub,
        apiUrlBase: apiUrl,
        apiVersionPrefix: versionPrefix
      });

      appSelf.onsuccess();

      // Respond to fetching the JWT.
      server.respondWith(
        'POST',
        apiUrl + versionPrefix + '/webpay/inapp/prepare/',
        // TODO: assert somehow that productId is part of post data.
        productData({webpayJWT: webpayJWT}));
      server.respond();

      mozPay.returnValues[0].onsuccess();

      server.respondWith(
        'POST',
        apiUrl + '/transaction/XYZ',
        transactionData());
      server.respond();

      receiptAdd.onsuccess();
    });

    it('should timeout polling the transaction', function (done) {

      fxpay.purchase('123', {
        onpurchase: function(err) {
          console.log('GOT error', err);
          assert.equal(err, 'TRANSACTION_TIMEOUT');
          done();
        },
        mozPay: mozPay,
        mozApps: mozAppsStub,
        maxTries: 2,
        pollIntervalMs: 1
      });

      appSelf.onsuccess();

      // Respond to fetching the JWT.
      server.respondWith(
        'POST',
        /http.*\/webpay\/inapp\/prepare/,
        productData());
      server.respond();

      mozPay.returnValues[0].onsuccess();

      server.autoRespond = true;
      server.respondWith(
        'POST',
        /http.*\/transaction\/XYZ/,
        transactionData({state: 'PENDING'}));
      server.respond();
    });

    it('should call back when mozPay window closes', function (done) {

      fxpay.purchase(123, {
        oncheckpayment: function() {
          done();
        },
        onpurchase: function(err) {
          // Make sure we don't have an unexpected error.
          assert.equal(err, null)
        },
        mozPay: mozPay,
        mozApps: mozAppsStub,
      });

      appSelf.onsuccess();

      // Respond to fetching the JWT.
      server.respondWith(
        'POST',
        /.*webpay\/inapp\/prepare/,
        productData());
      server.respond();

      mozPay.returnValues[0].onsuccess();

      // Respond to polling the transaction.
      server.respondWith(
        'POST',
        /.*\/transaction\/XYZ/,
        transactionData());
      server.respond();

      receiptAdd.onsuccess();
    });

    it('should call back with mozPay error', function (done) {

      fxpay.purchase(123, {
        onpurchase: function(err) {
          assert.equal(err, 'DIALOG_CLOSED_BY_USER');
          done();
        },
        mozPay: mozPay,
        mozApps: mozAppsStub,
      });

      appSelf.onsuccess();

      // Respond to fetching the JWT.
      server.respondWith(
        'POST',
        /.*webpay\/inapp\/prepare/,
        productData());
      server.respond();

      var domReq = mozPay.returnValues[0];
      domReq.error = {name: 'DIALOG_CLOSED_BY_USER'};
      domReq.onerror();
    });

    it('should report invalid transaction state', function (done) {
      var productId = 123;

      fxpay.purchase(productId, {
        onpurchase: function(err) {
          assert.equal(err, 'INVALID_TRANSACTION_STATE');
          done();
        },
        mozPay: mozPay,
        mozApps: mozAppsStub
      });

      appSelf.onsuccess();

      // Respond to fetching the JWT.
      server.respondWith(
        'POST',
        /http.*\/webpay\/inapp\/prepare/,
        productData());
      server.respond();

      mozPay.returnValues[0].onsuccess();

      // Respond to polling the transaction.
      server.respondWith(
        'POST',
        /http.*\/transaction\/XYZ/,
        transactionData({state: 'THIS_IS_NOT_A_VALID_STATE'}));
      server.respond();

      receiptAdd.onsuccess();
    });

    it('should error when apps are not supported', function (done) {
      fxpay.purchase('123', {
        onpurchase: function(err) {
          console.log('GOT error', err);
          assert.equal(err, 'PAY_PLATFORM_UNAVAILABLE');
          done();
        },
        mozPay: mozPay,
        mozApps: {},  // invalid mozApps.
      });
    });

    it('should error when mozPay is not supported', function (done) {
      fxpay.purchase('123', {
        onpurchase: function(err) {
          console.log('GOT error', err);
          assert.equal(err, 'PAY_PLATFORM_UNAVAILABLE');
          done();
        },
        mozPay: undefined,
        mozApps: mozAppsStub,
      });
    });

    it('should error when addReceipt does not exist', function (done) {
      var receipt = '<receipt>';

      var appStub = {
        addReceipt: undefined,  // older FxOSs do not have this.
        onsuccess: function() {},
        onerror: function() {}
      };
      appStub.result = appStub;  // result of DOM request.

      fxpay.purchase('123', {
        onpurchase: function(err) {
          assert.equal(err, 'PAY_PLATFORM_UNAVAILABLE');
          done();
        },
        mozPay: mozPay,
        mozApps: {
          getSelf: function() {
            return appStub;
          }
        },
      });

      appStub.onsuccess();
    });

    it('should pass through apps platform errors', function (done) {
      fxpay.purchase('123', {
        onpurchase: function(err) {
          console.log('GOT error', err);
          assert.equal(err, 'INVALID_MANIFEST');
          done();
        },
        mozPay: mozPay,
        mozApps: mozAppsStub,
      });

      // Simulate an apps platform error.
      appSelf.error = {name: 'INVALID_MANIFEST'};
      appSelf.onerror();
    });

    it('should error when not running as app', function (done) {
      fxpay.purchase('123', {
        onpurchase: function(err) {
          assert.equal(err, 'NOT_INSTALLED_AS_APP');
          done();
        },
        mozPay: mozPay,
        mozApps: mozAppsStub,
      });

      // This happens when you access the app from a browser
      // (i.e. not installed).
      appSelf.result = null;
      appSelf.onsuccess();
    });

    it('should add a Marketplace receipt to device', function (done) {
      var receipt = '<receipt>';

      fxpay.purchase('123', {
        onpurchase: function(err) {
          if (!err) {
            assert.equal(receiptAdd._receipt, receipt);
          }
          done(err);
        },
        mozPay: mozPay,
        mozApps: mozAppsStub,
      });

      appSelf.onsuccess();

      // Respond to fetching the JWT.
      server.respondWith(
        'POST',
        /.*\/webpay\/inapp\/prepare/,
        productData());
      server.respond();

      mozPay.returnValues[0].onsuccess();

      server.respondWith(
        'POST',
        /.*\/transaction\/XYZ/,
        transactionData({receipt: receipt}));
      server.respond();

      receiptAdd.onsuccess();
    });

    it('should pass through receipt errors', function (done) {
      fxpay.purchase('123', {
        onpurchase: function(err) {
          assert.equal(err, 'ADD_RECEIPT_ERROR');
          done();
        },
        mozPay: mozPay,
        mozApps: mozAppsStub,
      });

      appSelf.onsuccess();

      // Respond to fetching the JWT.
      server.respondWith(
        'POST',
        /.*\/webpay\/inapp\/prepare/,
        productData());
      server.respond();

      mozPay.returnValues[0].onsuccess();

      server.respondWith(
        'POST',
        /.*\/transaction\/XYZ/,
        transactionData());
      server.respond();

      // Simulate a receipt installation error.
      receiptAdd.error = {name: 'ADD_RECEIPT_ERROR'};
      receiptAdd.onerror();
    });
  });


  describe('API', function () {
    var api;
    var baseUrl = 'https://not-a-real-api';
    var versionPrefix = '/api/v1';

    beforeEach(function() {
      api = new fxpay.API(baseUrl, {versionPrefix: versionPrefix});
    });

    it('should handle POSTs', function (done) {
      server.respondWith(
        'POST', /.*\/post/,
        [200, {"Content-Type": "application/json"},
         '{"data": "received"}']);

      api.post('/post', {foo: 'bar'}, function(err, data) {
        assert.equal(data.data, 'received');
        done(err);
      });

      server.respond();
    });

    it('should handle GETs', function (done) {
      server.respondWith(
        'GET', /.*\/get/,
        [200, {"Content-Type": "application/json"},
         '{"data": "received"}']);

      api.get('/get', function(err, data) {
        assert.equal(data.data, 'received');
        done(err);
      });

      server.respond();
    });

    it('should handle PUTs', function (done) {
      server.respondWith(
        'PUT', /.*\/put/,
        [200, {"Content-Type": "application/json"},
         '{"data": "received"}']);

      api.put('/put', {foo: 'bar'}, function(err, data) {
        assert.equal(data.data, 'received');
        done(err);
      });

      server.respond();
    });

    it('should handle DELETEs', function (done) {
      server.respondWith(
        'DELETE', /.*\/delete/,
        [200, {"Content-Type": "application/json"},
         '{"data": "received"}']);

      api.del('/delete', function(err, data) {
        assert.equal(data.data, 'received');
        done(err);
      });

      server.respond();
    });

    it('should report XHR abort', function (done) {
      server.respondWith(function(xhr, id) {
        // We use a custom event because xhr.abort() triggers load first
        // https://github.com/cjohansen/Sinon.JS/issues/432
        dispatchXhrEvent(xhr, 'abort');
      });

      api.post('/some/path', null, function(err) {
        assert.equal(err, 'API_REQUEST_ABORTED');
        done();
      });

      server.respond();
    });

    it('should report XHR errors', function (done) {
      server.respondWith(function(xhr, id) {
        dispatchXhrEvent(xhr, 'error');
      });

      api.post('/some/path', null, function(err) {
        assert.equal(err, 'API_REQUEST_ERROR');
        done();
      });

      server.respond();
    });

    it('should report non-200 responses', function (done) {
      server.respondWith(
        'POST', /.*\/some\/path/,
        [500, {"Content-Type": "application/json"},
         JSON.stringify({webpayJWT: '<jwt>',
                         contribStatusURL: '/somewhere'})]);

      api.post('/some/path', null, function(err) {
        assert.equal(err, 'BAD_API_RESPONSE');
        done();
      });

      server.respond();
    });

    it('should report unparsable JSON', function (done) {
      server.respondWith(
        'POST', /.*\/some\/path/,
        [200, {"Content-Type": "application/json"},
         "{this\is not; valid JSON'"]);

      api.post('/some/path', null, function(err) {
        assert.equal(err, 'BAD_JSON_RESPONSE');
        done();
      });

      server.respond();
    });

    it('should parse and return JSON', function (done) {
      server.respondWith(
        'POST', /.*\/some\/path/,
        [200, {"Content-Type": "application/json"},
         '{"is_json": true}']);

      api.post('/some/path', null, function(err, data) {
        assert.equal(data.is_json, true);
        done(err);
      });

      server.respond();
    });

    it('should request a full URL based on a path', function (done) {
      server.respondWith(
        'POST', new RegExp(baseUrl + versionPrefix + '/path/check'),
        [200, {"Content-Type": "application/json"},
         '{"foo":"bar"}']);

      api.post('/path/check', null, function(err) {
        // If this is not a 404 then we're good.
        done(err);
      });

      server.respond();
    });

    it('should request an absolute URL when specified', function (done) {
      var absUrl = 'https://somewhere-else.com/some/page';

      server.respondWith('POST', absUrl,
                         [200, {"Content-Type": "application/json"},
                          '{"foo":"bar"}']);

      api.post(absUrl, null, function(err) {
        // If this is not a 404 then we're good.
        done(err);
      });

      server.respond();
    });

    it('should timeout', function (done) {
      server.respondWith(function(xhr, id) {
        // We simulate a timeout event here because Sinon
        // doesn't seem to support the XHR.timeout property.
        // https://github.com/cjohansen/Sinon.JS/issues/431
        dispatchXhrEvent(xhr, 'timeout');
      });

      api.post('/timeout', null, function(err) {
        assert.equal(err, 'API_REQUEST_TIMEOUT');
        done();
      });

      server.respond();
    });

    it('should allow you to get unversioned URLs', function (done) {
      assert.equal(api.url('/not/versioned', {versioned: false}),
                   baseUrl + '/not/versioned');
      done();
    });

    it('should allow you to get versioned URLs', function (done) {
      assert.equal(api.url('/this/is/versioned'),
                   baseUrl + versionPrefix + '/this/is/versioned');
      done();
    });
  });
});


function dispatchXhrEvent(xhr, eventName, bubbles, cancelable) {
  xhr.dispatchEvent(new sinon.Event(eventName, bubbles, cancelable, xhr));
  // Prevent future listening, like, in future tests.
  // Make this is fixed now?
  // See https://github.com/cjohansen/Sinon.JS/issues/430
  xhr.eventListeners = {};
}


function productData(overrides, status) {
  // Create a JSON server response to a request for product data.
  overrides = overrides || {};
  var data = {
    webpayJWT: '<jwt>',
    contribStatusURL: '/transaction/XYZ',
  };
  for (var k in data) {
    if (overrides[k]) {
      data[k] = overrides[k];
    }
  }
  return [status || 200, {"Content-Type": "application/json"},
          JSON.stringify(data)];
}


function transactionData(overrides, status) {
  // Create a JSON server response to a request for transaction data.
  overrides = overrides || {};
  var data = {
    // TODO: make the state value realistic.
    state: 'COMPLETED',
    // Pretend this is a real Marketplace receipt.
    receipt: '<keys>~<receipt>'
  };
  for (var k in data) {
    if (overrides[k]) {
      data[k] = overrides[k];
    }
  }
  return [status || 200, {"Content-Type": "application/json"},
          JSON.stringify(data)];
}


function mozPayStub() {
  // https://developer.mozilla.org/en-US/docs/Web/API/Navigator.mozPay
  return {
    onsuccess: function() {},
    onerror: function() {}
  };
}


var receiptAdd = {
  error: null,
  _receipt: null,
  onsuccess: function() {},
  onerror: function() {},
  reset: function() {
    this._receipt = null;
    this.error = null;
  }
};


var appSelf = {
  error: null,
  addReceipt: function(receipt) {
    receiptAdd._receipt = receipt;
    return receiptAdd;
  },
  onsuccess: function() {},
  onerror: function() {},
  init: function() {
    this.error = null;
    // This is the result of getSelf(). Setting it to this makes stubbing easier.
    this.result = this;
  }
};


// https://developer.mozilla.org/en-US/docs/Web/API/Apps.getSelf
var mozAppsStub = {
  getSelf: function() {
    return appSelf;
  }
};
