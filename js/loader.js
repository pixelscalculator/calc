var cmpChecker = (function () {
  // ver 142 - cmp ready -- inf scroll ready - dbg ready
  var CDN_SERVER = 'https://cdn.adx.ws';
  var API_URL = 'https://request.adx.ws';
  var AD_SERVER_URL = API_URL + '/ad';

  var cmpData = {
    tcfeu: '',
    gpp: '',
    usp: ''
  };
  var queueAds = [];
  var cookieSynced = false;
  var treeChangeDetected = false;
  var prereqRefreshFlag = null;
  var refreshParamsParsed = false;

  var loadedZones = {};
  var calledViewable = [];
  var calledImpressions = [];
  var zoneStatus = {};
  var secondsZone = {};
  var loadedAds = [];
  var doNotRefresh = [];

  var sevioDebugActive = false;
  var urlSearchParams = new URLSearchParams(window.location.search);
  var sevioDebug = urlSearchParams.get('sevioDebug');
  var sevioDebugLS = localStorage.getItem('sevioDebug');

  if (sevioDebug === 'true' || sevioDebugLS === 'true') sevioDebugActive = true;

  var updateLocalStorageKey = function (options) {
    var key = options.key;
    var nestedKey = options.nestedKey;
    var value = options.value;
    var settings = JSON.parse(localStorage.getItem(key)) || {};
    settings[nestedKey] = value;
    localStorage.setItem(key, JSON.stringify(settings));
  };

  var readLocalStorageKey = function (options) {
    var key = options.key;
    var nestedKey = options.nestedKey;
    var settings = JSON.parse(localStorage.getItem(key)) || {};
    if (nestedKey) {
      return settings[nestedKey];
    }
    return settings;
  };

  var getZoneRefreshParam = function (adDataZone, lookupParam) {
    var storeData = readLocalStorageKey({
      key: 'sevioads',
      nestedKey: 'refreshParams_' + adDataZone
    });

    return storeData !== undefined && storeData !== null
      ? storeData[lookupParam]
      : null;
  };

  var howManyLoaded = function (searchString) {
    var countLoaded = 0;
    for (var key in loadedZones) {
      if (
        loadedZones.hasOwnProperty(key) &&
        key.indexOf('adZone_' + searchString) === 0
      ) {
        countLoaded++;
      }
    }
    return countLoaded;
  };

  if (typeof window.loaderJsExecuted === 'undefined') {
    window.loaderJsExecuted = true;

    var cnt = 0;

    var refreshMain = function () {
      var schedRefresh = [];
      // debug status
      // if (sevioDebugActive) {
      //   console.log("---- zoneStatus ----");
      //   for (var key in zoneStatus) {
      //     if (zoneStatus.hasOwnProperty(key)) {
      //       console.log("zone " + key + ": " + zoneStatus[key]);
      //     }
      //   }
      // }

      // debug for seconds for each zone
      if (sevioDebugActive) {
        console.log('---- secondsZone: ----');
        console.table(secondsZone);
      }

      // get all elements from the DOM that have sevioads class
      var refreshElements = document.querySelectorAll('.sevioads');

      // populate with zeros on first tick
      for (var i = 0; i < refreshElements.length; i++) {
        var idKey = refreshElements[i].getAttribute('id');
        if (idKey && secondsZone[idKey] === undefined) {
          secondsZone[idKey] = 0;
          // Also if there aren't yet any local storage entries for the counter set them to zeros
          var existingCounter = readLocalStorageKey({
            key: 'sevioads',
            nestedKey: 'counterZone_' + idKey
          });
          if (
            typeof existingCounter === 'undefined' ||
            existingCounter === 'null'
          ) {
            updateLocalStorageKey({
              key: 'sevioads',
              nestedKey: 'counterZone_' + idKey,
              value: 0
            });
          }
        }
      }

      for (var i = 0; i < refreshElements.length; i++) {
        // check if the ad is in the VP
        if (
          typeof window.sevioads !== 'undefined' &&
          typeof sevioads.isAdInViewport === 'function' &&
          sevioads.isAdInViewport(refreshElements[i].getAttribute('id'))
        ) {
          var idRefreshEl = refreshElements[i].getAttribute('id');
          var lsZoneData = readLocalStorageKey({
            key: 'sevioads',
            nestedKey: 'adZone_' + refreshElements[i].getAttribute('id')
          });
          if (lsZoneData) {
            var refreshRate = getZoneRefreshParam(
              lsZoneData.zone,
              'refreshRate'
            );
            var refreshMaxTimes = getZoneRefreshParam(
              lsZoneData.zone,
              'refreshMaxTimes'
            );
            var refreshCounterInterval = getZoneRefreshParam(
              lsZoneData.zone,
              'refreshCounterInterval'
            );

            // increase couter in secondsZone object for each id
            if (secondsZone[idRefreshEl] === refreshRate) {
              // increase the counter in local storage
              var lastCounter = readLocalStorageKey({
                key: 'sevioads',
                nestedKey: 'counterZone_' + idRefreshEl
              });

              var isFoundDNR = doNotRefresh.indexOf(lsZoneData.zone) !== -1;

              if (!isFoundDNR) {
                var newCounter = lastCounter + 1;
              } else {
                var newCounter = lastCounter;
              }

              if (newCounter > refreshMaxTimes) {
                newCounter = refreshMaxTimes;
              } else {
                schedRefresh.push(idRefreshEl);
              }
              // when the counter exceeds the refreshCounterInterval we reset - the counter
              var timeStampZn = parseInt(
                readLocalStorageKey({
                  key: 'sevioads',
                  nestedKey: 'initialStartTime_' + idRefreshEl
                })
              );
              var intervalDiff = (Date.now() - timeStampZn) / 1000;
              if (
                intervalDiff >= refreshCounterInterval &&
                newCounter >= refreshMaxTimes
              ) {
                newCounter = 0;
                updateLocalStorageKey({
                  key: 'sevioads',
                  nestedKey: 'initialStartTime_' + idRefreshEl,
                  value: Date.now()
                });
              }

              // end reseting - the counter
              updateLocalStorageKey({
                key: 'sevioads',
                nestedKey: 'counterZone_' + idRefreshEl,
                value: newCounter
              });
              secondsZone[idRefreshEl] = 0;
            } else {
              secondsZone[idRefreshEl]++;
            }

            // console.log("RefreshRate:", refreshRate);
            // console.log('refreshMaxTimes:', refreshMaxTimes);
            // console.log('refreshCounterInterval:', refreshCounterInterval);

            // get refreshRate - number of sec after a refresh is made
            // get refreshMaxTimes value for the adID
            // get refreshCounterInterval - which is the interval for refresh cycle reinitialization
            // console.log("El:", refreshElements[i].getAttribute("id"));
          }
        }
      }

      // Executing the refresh - prepare refresh data
      if (
        typeof sevioads.prepareRefreshRequest !== 'undefined' &&
        typeof sevioads.prepareRefreshRequest === 'function'
      )
        sevioads.prepareRefreshRequest(schedRefresh);

      schedRefresh = []; // reseting scheduled refresh items
    };
    var refreshInterval = setInterval(refreshMain, 1000);

    function handleDocVisibility() {
      if (document.hidden) {
        clearInterval(refreshInterval);
        refreshInterval = null;
      } else {
        if (!refreshInterval) {
          refreshInterval = setInterval(refreshMain, 1000);
        }
      }
    }
    document.addEventListener('visibilitychange', handleDocVisibility);

    var waitForTcfApiCalled = false; // Flag to track if waitForTcfApi has been called
    function waitForTcfApi(callback, interval, maxAttempts) {
      // If waitForTcfApi has been called before, return early
      if (waitForTcfApiCalled) {
        console.log('waitForTcfApi already called. Skipping.');
        return;
      }

      // Use default values for interval and maxAttempts if not provided
      interval = interval || 100;
      maxAttempts = maxAttempts || 10;

      var attempts = 0;

      function checkTcfApi() {
        attempts++;

        if (typeof window.__tcfapi !== 'undefined') {
          callback();
          waitForTcfApiCalled = true; // Set the flag to true after calling waitForTcfApi
        } else if (attempts < maxAttempts) {
          setTimeout(checkTcfApi, interval);
        } else {
          console.log('sevioads: Max attempts reached. __tcfapi not found.');
          postCmpAction(cmpData);
          waitForTcfApiCalled = true; // Set the flag to true after reaching max attempts
        }
      }

      checkTcfApi();
    }

    var postCmpActionCalled = false;
    var postCmpAction = function (cmpData) {
      if (!postCmpActionCalled) {
        postCmpActionCalled = true;

        window.sevioads = (function () {
          var refreshTimerInitialized = false;
          var remoteParamUrls = [];
          var groupedRefresh = {};
          var initialPath = window.location.pathname;

          if (window.sevioadsInitialized) {
            return window.sevioads;
          }
          window.sevioadsInitialized = true;

          var sevioads = {
            push: function (args) {
              window.sevioadsData = window.sevioadsData || [];
              if (Array.isArray(args)) {
                var zoneIdsToMatch = [];

                for (var i = 0; i < args.length; i++) {
                  var cntAdsLoaded = howManyLoaded(args[i].zone);
                  args[i].placeholderId = args[i].zone + '_id_' + cntAdsLoaded;
                  args[i].loaded = true;
                  window.sevioadsData.push(args[i]);
                  zoneIdsToMatch.push(args[i].zone);

                  var elByDataZone = document.querySelectorAll(
                    '[data-zone="' + args[i].zone + '"]'
                  );
                  loadedZones[
                    'adZone_' + args[i].zone + '_id_' + cntAdsLoaded
                  ] = args[i];

                  updateLocalStorageKey({
                    key: 'sevioads',
                    nestedKey: 'adZone_' + args[i].zone + '_id_' + cntAdsLoaded,
                    value: args[i]
                  });

                  var initialAdStart = readLocalStorageKey({
                    key: 'sevioads',
                    nestedKey:
                      'initialStartTime_' + args[i].zone + '_id_' + cntAdsLoaded
                  });
                  if (!initialAdStart) {
                    updateLocalStorageKey({
                      key: 'sevioads',
                      nestedKey:
                        'initialStartTime_' +
                        args[i].zone +
                        '_id_' +
                        cntAdsLoaded,
                      value: Date.now()
                    });
                  }
                  zoneStatus[args[i].zone + '_id_' + cntAdsLoaded] = 'stopped';

                  var elNumber = 0;
                  if (elByDataZone && elByDataZone.length > 0) {
                    for (var j = 0; j < elByDataZone.length; j++) {
                      elByDataZone[j].setAttribute(
                        'id',
                        args[i].zone + '_id_' + elNumber++
                      );
                    }
                  }
                }

                var adPlaceholders = document.querySelectorAll('.sevioads');
                var sevioadsArray = [];
                for (var j = 0; j < adPlaceholders.length; j++) {
                  sevioadsArray.push(adPlaceholders[j]);
                }

                var filteredElements = [];
                for (var k = 0; k < sevioadsArray.length; k++) {
                  var element = sevioadsArray[k];
                  var dataZoneValue = element.getAttribute('data-zone');
                  if (zoneIdsToMatch.indexOf(dataZoneValue) !== -1) {
                    filteredElements.push(element);
                  }
                }
              }

              if (!cookieSynced) {
                this.cookieSyncing(args);
                queueAds.push({ foundAds: filteredElements });
              } else {
                sevioads.loadingRequest({ foundAds: filteredElements });
              }

              loadBannerAd['initialized'] = function (args) {
                return new this(args);
              };
              loadBannerAd['initialized'](args);
            },

            cookieSyncing: function (args) {
              if (Array.isArray(args)) {
                var inventoryId = args[0].inventoryId;
              } else {
                var inventoryId = args.inventoryId;
              }
              sevioads.loadServerUrl({
                serverUrl: API_URL + '/uids',
                cFunction: function (response) {
                  if (
                    response.xhttp.readyState === 4 &&
                    response.xhttp.status === 200
                  ) {
                    var bidderItems = JSON.parse(response.xhttp.responseText);
                    sevioads.biddersHandler(bidderItems.bidders, function () {
                      sevioads.processQueuedAds();
                    });
                  } else {
                    sevioads.processQueuedAds();
                  }
                },
                serverMethod: 'POST',
                cType: 'application/json',
                data: JSON.stringify({
                  inventoryId: inventoryId,
                  tcfeu: cmpData.tcfeu,
                  usp: cmpData.usp,
                  gpp: cmpData.gpp
                })
              });

              cookieSynced = true;
            },

            loadSyncItem: function (bidderItem, callback) {
              if (bidderItem.userSyncMethod === 'REDIRECT') {
                var img = new Image();
                img.onload = function () {
                  callback();
                };

                img.onerror = function () {
                  callback();
                };
                img.src = bidderItem.url;
                img.style.display = 'none';
                document.body.appendChild(img);
              }
              if (bidderItem.userSyncMethod === 'IFRAME') {
                var iframeSync = document.createElement('iframe');
                iframeSync.style.display = 'none';

                iframeSync.onload = function () {
                  callback();
                  document.body.removeChild(iframeSync);
                };

                iframeSync.onerror = function () {
                  callback();
                  document.body.removeChild(iframeSync);
                };

                iframeSync.src = bidderItem.url;
                document.body.appendChild(iframeSync);
                callback();
              }
            },

            biddersHandler: function (bidderItems, allItemsLoadedCallback) {
              var loadedCount = 0;

              function checkCompletion() {
                loadedCount++;

                if (loadedCount === bidderItems.length) {
                  allItemsLoadedCallback();
                }
              }
              for (var i = 0; i < bidderItems.length; i++) {
                this.loadSyncItem(bidderItems[i], checkCompletion);
              }
            },

            processQueuedAds: function () {
              for (var x = 0; x < queueAds.length; x++) {
                sevioads.loadingRequest(queueAds[x]);
              }
            },

            renderAds: function (response) {
              var objKeys = Object.keys(response.winningBidsByTagId);
              for (var i = 0; i < objKeys.length; i++) {
                var adData = response.winningBidsByTagId[objKeys[i]];

                for (var k = 0; k < adData.referenceIDs.length; k++) {
                  this.associateViewableIdToZone({
                    referenceId: adData.referenceIDs[k],
                    viewableURL: adData.viewableURL
                  });

                  var index = calledViewable.indexOf(adData.viewableURL);
                  if (index !== -1) calledViewable.splice(index, 1);
                  var indexImp = calledImpressions.indexOf(adData.impURL);
                  if (indexImp !== -1) calledImpressions.splice(indexImp, 1);

                  var adPlaceholder = document.getElementById(
                    adData.referenceIDs[k]
                  );

                  var adRenderParams = this.getParamsById(objKeys[i]);
                  if (adRenderParams.adType === 'native') {
                    var adDataDecoded = adData.adm;
                    var adDecoded = JSON.parse(adDataDecoded);
                    var defaultVarsUrl = adDecoded.link.ext.defaults;

                    var htmlNativeTemplateUrl = adDecoded.link.ext.template;
                    var nativeLanding = {
                      name: 'clickURL',
                      type: 'TEXT',
                      value: adDecoded.link.url
                    };

                    sevioads.loadServerUrl({
                      serverUrl: defaultVarsUrl,
                      cFunction: function (cdnDefResponse) {
                        if (
                          cdnDefResponse.xhttp.readyState === 4 &&
                          cdnDefResponse.xhttp.status === 200
                        ) {
                          var defaultItemVars = JSON.parse(
                            cdnDefResponse.xhttp.responseText
                          );
                          var formattedValues =
                            sevioads.formatUsingDefaultValues({
                              defaultItemVars,
                              assets: cdnDefResponse.settings.assets
                            });

                          formattedValues.push(
                            cdnDefResponse.settings.nativeLanding
                          );

                          sevioads.loadServerUrl({
                            serverUrl:
                              cdnDefResponse.settings.htmlNativeTemplateUrl,
                            cFunction: function (htmlResponse) {
                              if (
                                htmlResponse.xhttp.readyState === 4 &&
                                htmlResponse.xhttp.status === 200
                              ) {
                                var htmlNativeTemplate =
                                  htmlResponse.xhttp.responseText;
                                var resNativeTemplate =
                                  sevioads.replaceNativeVars({
                                    htmlNativeTemplate: htmlNativeTemplate,
                                    formattedValues: formattedValues
                                  });
                                cdnDefResponse.settings.adPlaceholder.innerHTML =
                                  resNativeTemplate;

                                // native ad render successfully
                                // console.log(
                                //   '%cZONE_placeholder' +
                                //     adData.referenceIDs[0] +
                                //     ' sentImpURL:' +
                                //     adData.impURL,
                                //   'color: green'
                                // );

                                sevioads.loadServerUrl({
                                  serverUrl: adData.impURL,
                                  cFunction: sevioads.onRender,
                                  serverMethod: 'GET',
                                  cType: 'text/html',
                                  eventTrackerType: 1,
                                  eventTrackers: adData.eventTrackers
                                });
                                sevioads.markLoadedAd(objKeys[i]);
                              }
                            },
                            serverMethod: 'GET',
                            cType: 'text/html',
                            settings: 'read-native-template'
                          });
                        }
                      },
                      serverMethod: 'GET',
                      cType: 'application/json',
                      settings: {
                        htmlNativeTemplateUrl: htmlNativeTemplateUrl,
                        adPlaceholder: adPlaceholder,
                        nativeLanding: nativeLanding,
                        assets: adDecoded.assets
                      }
                    });

                    adPlaceholder.setAttribute('data-rendered', 'true');
                    if (adData.eventTrackers) {
                      adPlaceholder.setAttribute(
                        'data-event-trackers',
                        JSON.stringify(adData.eventTrackers)
                      );
                    }
                    observer.unobserve(adPlaceholder);
                    observer.observe(adPlaceholder);
                    continue;
                  }

                  adPlaceholder.setAttribute('data-rendered', 'true');
                  if (adData.eventTrackers) {
                    adPlaceholder.setAttribute(
                      'data-event-trackers',
                      JSON.stringify(adData.eventTrackers)
                    );
                  }

                  var tbAdDiv = document.createElement('div');
                  tbAdDiv.id =
                    'sevio_iframe_markup_' + adData.width + 'x' + adData.height;
                  tbAdDiv.setAttribute('data-rendered', 'true');

                  try {
                    if (adData.render === 'r') {
                      doNotRefresh.push(objKeys[i]); // adsense
                      adPlaceholder.setAttribute(
                        'style',
                        'display: inline-block; width: inherit; height: inherit;'
                      );
                      tbAdDiv.setAttribute(
                        'style',
                        'display: inline-block; width: inherit; height: inherit;'
                      );
                      sevioads.loadServerUrl({
                        serverUrl: adData.admURL,
                        cFunction: function (cdnScript) {
                          if (
                            cdnScript.xhttp.readyState === 4 &&
                            cdnScript.xhttp.status === 200
                          ) {
                            var scriptContent =
                              'var adContainer = (function() { ' +
                              cdnScript.xhttp.responseText +
                              '  return container; })();';
                            try {
                              eval.call(tbAdDiv, scriptContent);
                            } catch (e) {
                              console.log(
                                'Error on external script execution.'
                              );
                            }
                            if (typeof adContainer !== 'undefined') {
                              tbAdDiv.appendChild(adContainer);
                            }
                          }
                        },
                        serverMethod: 'GET',
                        cType: 'application/json',
                        settings: {}
                      });
                    } else {
                      adPlaceholder.setAttribute(
                        'style',
                        'max-width:' +
                          adData.width +
                          'px; width:' +
                          adData.width +
                          'px; height:' +
                          adData.height +
                          'px; display: inline-block;'
                      );
                      tbAdDiv.setAttribute(
                        'style',
                        'max-width: ' +
                          adData.width +
                          'px; width:' +
                          adData.width +
                          'px; height:' +
                          adData.height +
                          'px; display: inline-block;'
                      );

                      var iFrame = document.createElement('iframe');
                      if (adData.admURL) {
                        iFrame.src = adData.admURL;
                      }
                      iFrame.setAttribute('scrolling', 'no');
                      iFrame.setAttribute(
                        'style',
                        'border: 0; overflow: hidden; margin:0 auto; width: 100%; max-width: ' +
                          adData.width +
                          ';height: 100%; max-height: ' +
                          adData.height +
                          ';'
                      );
                      iFrame.setAttribute('frameborder', '0');
                      iFrame.setAttribute('allowtransparency', 'true');
                      tbAdDiv.appendChild(iFrame);
                    }
                  } catch (e) {
                    console.log('Error during ad rendering:', e);
                  }

                  adPlaceholder.appendChild(tbAdDiv);
                  if (adData.eventTrackers) {
                    adPlaceholder.setAttribute(
                      'data-event-trackers',
                      JSON.stringify(adData.eventTrackers)
                    );
                  }

                  var isImpLinkUsed =
                    calledImpressions.indexOf(adData.impURL) !== -1;

                  if (!isImpLinkUsed) {
                    // console.log(
                    //   '%cZONE_placeholder' +
                    //     adData.referenceIDs[k] +
                    //     ' sentImpURL:' +
                    //     adData.impURL,
                    //   'color: green'
                    // );
                    sevioads.loadServerUrl({
                      serverUrl: adData.impURL,
                      cFunction: sevioads.onRender,
                      serverMethod: 'GET',
                      cType: 'text/html',
                      eventTrackerType: 1,
                      eventTrackers: adData.eventTrackers
                    });
                    calledImpressions.push(adData.impURL);
                    sevioads.markLoadedAd(objKeys[i]);

                    observer.unobserve(adPlaceholder);
                    observer.observe(adPlaceholder);
                  }
                }
              }
            },
            markLoadedAd: function (adData) {
              window.sevioadsData.map(function (adItem) {
                if (adItem.zone === adData) {
                  adItem.loaded = true;
                }
                return adItem;
              });
            },
            onUrlChange: function () {
              console.log('Called onUrlChange');
            },
            associateViewableIdToZone: function (props) {
              try {
                var referenceId = props.referenceId;
                var viewableURL = props.viewableURL;
                if (sevioadsData.length) {
                  for (var i = 0; i < sevioadsData.length; i++) {
                    if (sevioadsData[i].placeholderId === referenceId)
                      sevioadsData[i].viewableURL = viewableURL;
                  }
                }
              } catch (e) {
                console.log('Error: ', e);
              }
            },
            refresh: function () {
              cookieSynced = false;
            },
            onRender: function (gParams) {
              if (
                gParams.xhttp.readyState === 4 &&
                gParams.xhttp.status === 200
              ) {
                try {
                } catch (e) {
                  console.log('Error onRender:' + e);
                }
              }
            },

            formatUsingDefaultValues: function ({ defaultItemVars, assets }) {
              if (defaultItemVars.length) {
                for (var i = 0; i < defaultItemVars.length; i++) {
                  for (var j = 0; j < assets.length; j++) {
                    if (
                      defaultItemVars[i].name === assets[j].name &&
                      assets[j].value !== null
                    ) {
                      defaultItemVars[i] = assets[j];
                    }
                  }
                }
              }
              return defaultItemVars;
            },

            replaceNativeVars: function (replElements) {
              var formattedValues = replElements.formattedValues;
              var htmlNativeTemplate = replElements.htmlNativeTemplate;

              var regex = /"?\[%([^%]+)%\]"?/g;

              var replTemplate = htmlNativeTemplate.replace(
                regex,
                function (match, p1) {
                  for (var i = 0; i < formattedValues.length; i++) {
                    if (formattedValues[i].name === p1) {
                      if (match[0] === '[' && match[match.length - 1] === ']') {
                        return formattedValues[i].value;
                      } else {
                        return (
                          match[0] +
                          formattedValues[i].value +
                          match[match.length - 1]
                        );
                      }
                    }
                  }
                  return match;
                }
              );

              return replTemplate;
            },
            fetchServerData: function (sParams) {
              if (
                sParams.xhttp.readyState === 4 &&
                sParams.xhttp.status === 200
              ) {
                try {
                  var jsonResponse = JSON.parse(sParams.xhttp.responseText);
                  if (sParams.settings === 'refresh') {
                    sevioads.reRenderAds(jsonResponse);
                  } else {
                    sevioads.renderAds(jsonResponse);
                  }
                } catch (e) {
                  console.log('Error loading ad' + e);
                }
              }
            },
            getNonce: function () {
              return (
                Math.floor(Math.random() * 1000000000000) + new Date().getTime()
              );
            },

            loadingRequest: function (loadingProps) {
              var foundAds = loadingProps.foundAds;
              var requestData = { ads: [] };
              if (!foundAds) return;
              for (var i = 0; i < foundAds.length; i++) {
                var myElement = foundAds[i];
                var requestDataAdElement = {};
                var adZone = myElement.getAttribute('data-zone');
                var placeholderId = myElement.getAttribute('id');
                var zoneParams = sevioads.getParamsById(adZone);

                requestDataAdElement.type = zoneParams.adType.toUpperCase();
                requestDataAdElement.tagId = adZone;
                requestDataAdElement.referenceId = placeholderId;

                if (sevioDebugActive) console.log('AdParams:', zoneParams);

                var cdnPath =
                  CDN_SERVER +
                  '/' +
                  zoneParams.accountId +
                  '/inventories/' +
                  zoneParams.inventoryId +
                  '.json';
                if (
                  zoneParams.hasOwnProperty('inventoryId') &&
                  zoneParams.hasOwnProperty('accountId') &&
                  !(remoteParamUrls.indexOf(cdnPath) !== -1)
                ) {
                  remoteParamUrls.push(cdnPath);
                }

                if (
                  zoneParams.adType.toLowerCase() === 'banner' &&
                  zoneParams.width &&
                  zoneParams.height
                ) {
                  requestDataAdElement.sizes = [
                    {
                      width: zoneParams.width,
                      height: zoneParams.height
                    }
                  ];
                }
                var adSizes = document.querySelector(
                  '[data-zone="' + zoneParams.zone + '"]'
                );
                requestDataAdElement.maxSize = {
                  width: adSizes.parentNode.offsetWidth,
                  height: adSizes.parentNode.offsetHeight
                };

                loadedAds.push(placeholderId);
                requestDataAdElement.referenceId = placeholderId;
                requestData.ads.push(requestDataAdElement);
                break;
              }

              if (sevioDebugActive) {
                console.log('RequestDATA:', requestData);
              }

              requestData.privacy = cmpData;

              var nonce = sevioads.getNonce();

              if (requestData.ads.length > 0) {
                sevioads.loadServerUrl({
                  serverUrl: AD_SERVER_URL + '?t=' + Date.now(),
                  cFunction: sevioads.fetchServerData,
                  serverMethod: 'POST',
                  cType: 'application/json',
                  xNonce: nonce,
                  data: JSON.stringify(requestData)
                });

                if (prereqRefreshFlag === null) {
                  prereqRefreshFlag = 1;
                  sevioads.prereqRefresh();
                }
              }
            },
            fetchJsonParams: function (sParams) {
              if (
                sParams.xhttp.readyState === 4 &&
                sParams.xhttp.status === 200
              ) {
                try {
                  for (var key in zoneStatus) {
                    if (zoneStatus.hasOwnProperty(key)) {
                      zoneStatus[key] = 'stopped';
                    }
                  }

                  var jsonResponse = JSON.parse(sParams.xhttp.response);
                  var zoneItems = Object.keys(jsonResponse);

                  for (var i = 0; i < zoneItems.length; i++) {
                    updateLocalStorageKey({
                      key: 'sevioads',
                      nestedKey: 'refreshParams_' + zoneItems[i],
                      value: jsonResponse[zoneItems[i]]
                    });

                    if (sevioads.getParamsById(zoneItems[i])) {
                      var refreshKey =
                        'rRate_' +
                        jsonResponse[zoneItems[i]].refreshRate +
                        '_rMaxTimes_' +
                        jsonResponse[zoneItems[i]].refreshMaxTimes +
                        '_rCounterInterval_' +
                        jsonResponse[zoneItems[i]].refreshCounterInterval;
                      if (groupedRefresh.hasOwnProperty(refreshKey)) {
                        groupedRefresh[refreshKey].zones.push(zoneItems[i]);
                      } else {
                        groupedRefresh[refreshKey] = {
                          refreshParams: jsonResponse[zoneItems[i]],
                          zones: [zoneItems[i]]
                        };
                      }
                    }
                  }
                  sParams.settings();
                } catch (e) {
                  console.log('Error parsing remote params' + e);
                }
              }
            },
            isAdInViewport: function (zoneId) {
              var adElement = document.getElementById(zoneId);

              if (!adElement) {
                return false;
              }

              var adRect = adElement.getBoundingClientRect();
              var adTop = adRect.top;
              var adBottom = adRect.bottom;
              var adLeft = adRect.left;
              var adRight = adRect.right;
              var windowHeight =
                window.innerHeight || document.documentElement.clientHeight;
              var windowWidth =
                window.innerWidth || document.documentElement.clientWidth;

              return (
                adBottom > 0.5 * adRect.height &&
                adTop < windowHeight - 0.5 * adRect.height &&
                adRight > 0 &&
                adLeft < windowWidth
              );
            },
            prereqRefresh: function () {
              if (remoteParamUrls.length) {
                var completedRequests = 0;

                function checkAndResolve() {
                  completedRequests++;
                  if (completedRequests === remoteParamUrls.length) {
                    refreshParamsParsed = true;
                  }
                }

                var nonce = sevioads.getNonce();

                for (var i = 0; i < remoteParamUrls.length; i++) {
                  sevioads.loadServerUrl({
                    serverUrl: remoteParamUrls[i],
                    cFunction: function () {
                      sevioads.fetchJsonParams.apply(this, arguments);
                      checkAndResolve();
                    },
                    serverMethod: 'GET',
                    cType: 'application/json',
                    xNonce: nonce,
                    settings: function () {}
                  });
                }
              }
            },
            reRenderAds: function (response) {
              var objRespKeys = Object.keys(response.winningBidsByTagId);
              for (var i = 0; i < objRespKeys.length; i++) {
                for (
                  var k = 0;
                  k <
                  response.winningBidsByTagId[objRespKeys[i]].referenceIDs
                    .length;
                  k++
                ) {
                  var adPlaceholder = document.getElementById(
                    response.winningBidsByTagId[objRespKeys[i]].referenceIDs[k]
                  );
                  if (adPlaceholder) {
                    adPlaceholder.innerHTML = '';
                    observer.unobserve(adPlaceholder);
                    observer.observe(adPlaceholder);
                  }
                }
              }
              sevioads.renderAds(response);
            },
            getParamsByElementId: function (elementId) {
              var keyIdParams = readLocalStorageKey({
                key: 'sevioads',
                nestedKey: 'adZone_' + elementId
              });
              return keyIdParams;
            },
            getParamsById: function (elZone) {
              var paramsFound = window.sevioadsData.filter(function (obj) {
                return obj.zone === elZone;
              })[0];
              return paramsFound;
            },

            prepareRefreshRequest: function (rData) {
              var requestDataRefresh = { ads: [] };
              requestDataRefresh.privacy = cmpData;

              for (var i = 0; i < rData.length; i++) {
                var reqDataAdItemRefresh = {};
                var refreshAdParams = this.getParamsByElementId(rData[i]);

                reqDataAdItemRefresh.referenceId =
                  refreshAdParams.placeholderId;
                reqDataAdItemRefresh.type =
                  refreshAdParams.adType.toUpperCase();
                reqDataAdItemRefresh.tagId = refreshAdParams.zone;
                if (
                  refreshAdParams.adType.toLowerCase() === 'banner' &&
                  refreshAdParams.width &&
                  refreshAdParams.height
                ) {
                  requestDataAdElement.sizes = [
                    {
                      width: refreshAdParams.width,
                      height: refreshAdParams.height
                    }
                  ];
                }
                var adSizesRefresh = document.getElementById(rData[i]);
                reqDataAdItemRefresh.maxSize = {
                  width: adSizesRefresh.parentNode.offsetWidth,
                  height: adSizesRefresh.parentNode.offsetHeight
                };
                requestDataRefresh.ads.push(reqDataAdItemRefresh);
              }

              requestDataRefresh.ads = requestDataRefresh.ads.filter(
                function (ad) {
                  return doNotRefresh.indexOf(ad.tagId) === -1;
                }
              );

              if (requestDataRefresh.ads.length > 0) {
                var nonce = sevioads.getNonce();

                requestDataRefresh.privacy = cmpData;

                sevioads.loadServerUrl({
                  serverUrl:
                    AD_SERVER_URL + '?t=' + Date.now() + '&refresh=true',
                  cFunction: sevioads.fetchServerData,
                  serverMethod: 'POST',
                  cType: 'application/json',
                  xNonce: nonce,
                  data: JSON.stringify(requestDataRefresh),
                  settings: 'refresh'
                });
              }
            },

            loadServerUrl: function (loadParams) {
              if (!loadParams.serverUrl) return false;
              var xhttp = new XMLHttpRequest();
              xhttp.onload = function () {
                loadParams.cFunction({
                  xhttp: this,
                  data: loadParams.data,
                  settings: loadParams.settings
                });
              };
              xhttp.open(loadParams.serverMethod, loadParams.serverUrl);
              if (loadParams.cType) {
                xhttp.setRequestHeader('Content-Type', loadParams.cType);
              }
              if (loadParams.xNonce) {
                xhttp.setRequestHeader('X-Nonce', loadParams.xNonce);
              }

              if (
                loadParams.eventTrackers &&
                loadParams.eventTrackers.length > 0
              ) {
                var filteredEventTrackers = loadParams.eventTrackers.filter(
                  function (et) {
                    return et.type === loadParams.eventTrackerType;
                  }
                );

                if (filteredEventTrackers.length > 0) {
                  for (
                    var index = 0;
                    index < filteredEventTrackers.length;
                    index++
                  ) {
                    xhttp.setRequestHeader(
                      'TB-Event-Tracker' + index,
                      filteredEventTrackers[index].url
                    );
                  }
                }
              }

              if (loadParams.data) {
                xhttp.send(loadParams.data);
              } else {
                xhttp.send();
              }
            },

            onHideDocument: function () {
              for (var key in zoneStatus) {
                if (zoneStatus.hasOwnProperty(key)) {
                  zoneStatus[key] = 'stopped';
                  var adPlaceholder = document.getElementById(key);
                  if (adPlaceholder) {
                    observer.unobserve(adPlaceholder);
                  }
                }
              }
            },
            onDocumentVisible: function () {
              for (var key in zoneStatus) {
                if (zoneStatus.hasOwnProperty(key)) {
                  var adPlaceholder = document.getElementById(key);
                  if (adPlaceholder) {
                    observer.observe(adPlaceholder);
                  }
                }
              }
            },
            getViewableURLById: function (placeholderId) {
              var foundViewableURL = '';
              if (sevioadsData.length) {
                for (var i = 0; i < sevioadsData.length; i++) {
                  if (sevioadsData[i].placeholderId === placeholderId) {
                    foundViewableURL = sevioadsData[i].viewableURL;
                  }
                }
              }
              return foundViewableURL;
            },
            adInViewport: function (adItem) {
              setTimeout(function () {
                treeChangeDetected = false;
              }, 1000);
              var adZn = adItem.getAttribute('data-zone');
              var adDataZoneId = adItem.getAttribute('id');
              var viewableLink = this.getViewableURLById(adDataZoneId);

              var isFoundExternal = doNotRefresh.indexOf(adZn) !== -1;

              if (isFoundExternal) {
                zoneStatus[adDataZoneId] = 'stopped';
              } else {
                zoneStatus[adDataZoneId] = 'started';
              }

              var isViewableLinkUsed =
                calledViewable.indexOf(viewableLink) !== -1;
              if (!isViewableLinkUsed) {
                var eventTrackers = JSON.parse(
                  adItem.getAttribute('data-event-trackers')
                );

                var targetInViewport = sevioads.isAdInViewport(adDataZoneId);
                if (!targetInViewport) {
                  return;
                }

                // console.log(
                //   '%cZONE_placeholder' +
                //     adDataZoneId +
                //     ' sentviewableURL:' +
                //     viewableLink,
                //   'color: orange'
                // );

                sevioads.loadServerUrl({
                  serverUrl: viewableLink,
                  cFunction: function () {
                    calledViewable.push(viewableLink);
                  },
                  serverMethod: 'GET',
                  cType: 'text/html',
                  eventTrackerType: 2,
                  eventTrackers: eventTrackers
                });
              }
            }
          };

          var observer = new IntersectionObserver(
            function (entries) {
              entries.forEach(function (entry) {
                var isIntersecting =
                  entry.isIntersecting && entry.intersectionRatio >= 0.5;
                if (sevioDebugActive) {
                  console.log('Entries:', entries);
                  console.log('OBSERVER initialized');
                }

                if (isIntersecting) {
                  setTimeout(function () {
                    if (isIntersecting) {
                      if (!document.hidden) {
                        var computedStyle = window.getComputedStyle(
                          entry.target
                        );
                        var visibilityStyle =
                          computedStyle.getPropertyValue('visibility');

                        if (visibilityStyle === 'visible') {
                          if (sevioDebugActive) {
                            console.log(
                              'Ad in viewport',
                              entry.target.getAttribute('data-zone')
                            );
                            console.log(
                              'Intersection ratio:',
                              entry.intersectionRatio
                            );
                          }

                          sevioads.adInViewport(entry.target);
                        }
                      }
                    }
                  }, 1000);
                } else {
                  var adDataZone = entry.target.getAttribute('data-zone');

                  setTimeout(function () {
                    if (sevioDebugActive) {
                      console.log(
                        'Intersection ratio OUTofViewport:',
                        entry.intersectionRatio
                      );
                      console.log('Ad not in viewport:', adDataZone);
                    }
                    zoneStatus[entry.target.getAttribute('id')] = 'stopped';
                  }, 1000);
                }
              });
            },
            { threshold: 0.5 }
          );

          var loadBannerAd = function (args) {
            this.construct(args);
          };

          loadBannerAd.prototype.construct = function (props) {
            this.props = props;
          };

          if (typeof window.sevioads !== 'undefined') {
            for (var i = 0; i < window.sevioads.length; i++) {
              sevioads.push(window.sevioads[i]);
            }
          }

          function handleVisibilityChange() {
            if (document.hidden) {
              sevioads.onHideDocument(); // stop all statuses when document looses visibility
            } else {
              sevioads.onDocumentVisible();
            }
          }
          document.addEventListener('visibilitychange', handleVisibilityChange);

          function handleStyleChanges(mutationsList) {
            mutationsList.forEach(function (mutation) {
              var sevioadsElements =
                mutation.target.querySelectorAll('.sevioads');

              sevioadsElements.forEach(function (sevioadsElement) {
                var computedStyle = window.getComputedStyle(sevioadsElement);
                var visibilityStyle =
                  computedStyle.getPropertyValue('visibility');
                var displayStyle = computedStyle.getPropertyValue('display');
                var opacityValue = computedStyle.getPropertyValue('opacity');

                if (
                  visibilityStyle === 'hidden' &&
                  displayStyle === 'block' &&
                  parseInt(opacityValue) === 1
                ) {
                  if (sevioDebugActive) {
                    console.log(
                      'Child Element with class "sevioads" is visible and has changed display:',
                      sevioadsElement
                    );
                  }

                  if (
                    !treeChangeDetected &&
                    initialPath === window.location.pathname
                  ) {
                    sevioads.adInViewport(sevioadsElement);
                    treeChangeDetected = true;
                  }
                }
              });
            });
          }

          var rootElement = document.documentElement;
          var mutationObserver = new MutationObserver(handleStyleChanges);
          mutationObserver.observe(rootElement, {
            attributes: true,
            subtree: true,
            attributeFilter: ['style', 'class']
          });

          return sevioads;
        })();
      }
    };

    waitForTcfApi(function () {
      console.log('sevioads: __tcfapi is now available.');
      var checkCMP = function () {
        if (typeof __gpp !== 'undefined' && typeof __gpp === 'function') {
          try {
            var gppData = __gpp('ping');
            cmpData.gpp = gppData.gppString || '';
            postCmpAction(cmpData);
          } catch (e) {}
        }

        if (typeof __uspapi !== 'undefined' && typeof __uspapi === 'function') {
          try {
            __uspapi('getUSPData', 1, function (uspData, success) {
              if (success) {
                cmpData.usp = uspData.uspString || '';
                postCmpAction(cmpData);
              }
            });
          } catch (e) {}
        }

        if (typeof __tcfapi !== 'undefined' && typeof __tcfapi === 'function') {
          try {
            __tcfapi('addEventListener', 2, function (tcData, success) {
              if (success && tcData.eventStatus === 'tcloaded') {
                cmpData.tcfeu = tcData.tcString;
                cmpData.state = 'tcloaded';
                postCmpAction(cmpData);
              } else if (
                success &&
                tcData.eventStatus === 'useractioncomplete'
              ) {
                console.log('completed the action');
                cmpData.tcfeu = tcData.tcString;
                cmpData.state = 'useractioncomplete';
                postCmpAction(cmpData);
              } else {
                console.log('sevioads: TCF not loaded');
              }
            });
          } catch (e) {
            console.log('sevioads: TCF error:', e);
          }
        } else {
          cmpData.state = 'UNKNOWN';
          postCmpAction(cmpData);
        }
      };
      checkCMP();
    });
  }

  function handleBeforeUnload() {
    localStorage.removeItem('refreshTB');
    localStorage.removeItem('refreshStoreTB');

    window.removeEventListener('beforeunload', handleBeforeUnload);
  }

  window.addEventListener('beforeunload', function (event) {
    setTimeout(handleBeforeUnload, 0);
  });

  window.addEventListener('load', function () {
    for (var i = 0; i < localStorage.length; i++) {
      var key = localStorage.key(i);
      if (key.indexOf('remainingTime_') === 0) {
        localStorage.removeItem(key);
      }
    }
  });
})();
