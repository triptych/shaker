YUI.add('mojito-shaker-addon', function(Y, NAME) {
    var libfs = require('fs'),libpath = require('path');

    function filterAssets(appConfig,list){
            var app = appConfig,
                regularExp = '/' + app.prefix +'/([^/]+)/.*',
                groups = {
                    app:[],
                    core:[],
                    mojits:[]
                };
            for(var i = 0 ; i<list.length; i++){
                var item = list[i],
                    matched = item.match(regularExp),
                    type = matched && matched.pop();
                if(type){
                    switch(type){
                        case app.frameworkName: groups.core.push(matched.pop()); break;
                        case app.appName: groups.app.push(matched.pop());break;
                        default: groups.mojits.push(matched.pop());break;
                    }
                }
            }
            return groups;
    }

    function ShakerAddon(command, adapter, ac) {
        this._ac = ac;// the future action context of the mojit (not attached yet if mojit created dynamically)
        this._adapter = adapter;// where the functions done and error live before attach them to the ac.
        this._command = command;//all the configuration for the mojit
        this._init(ac);
    }

    ShakerAddon.prototype = {
        namespace: 'shaker',

        _init:function(ac){
            this._app = this._setAppConfig(ac);
            this._meta = YUI._mojito._cache.shaker.meta;
        },
        _setAppConfig: function(ac){
            var app = ac.app.config.staticHandling || {};
            app.appName = app.appName || libpath.basename(process.cwd());
            app.frameworkName = app.frameworkName || 'mojito';
            app.prefix = app.prefix || 'static';
            return app;
        },
        _matchDimensions :function(selector,dimensions,action,shaken){
            var parts = selector.split('-'),
                matched = '', aux;
                    while(parts.length){
                        aux = parts.shift();
                        if(aux === 'common'){
                            matched+= matched ? '-' + aux : aux;
                        }else if(aux === 'action'){
                            action = shaken[matched + '-' + action] ? action : 'action';
                            matched+=matched? '-' + action: action;
                        }else{// common case dimensions

                            //we find a matched dimension in shaken
                            if(typeof dimensions[aux] !== 'undefined' && shaken[matched + '-' + dimensions[aux] ]){
                                matched+= matched ? '-' + dimensions[aux] : dimensions[aux];
                            }else if(shaken[matched+'-'+aux]){//if we have the default name keep going
                                matched+= matched ? '-' + aux : aux;
                                continue;
                            }else{
                                break;
                            }
                        }
                    }
                    return matched;
        },
        _matchMojitDimensions: function(mojit,binder){
            var mojitAll = this._meta.mojits[mojit],
                action = binder || '*',
                mojitmeta = mojitAll && mojitAll[action],
                selectors = mojitmeta && mojitmeta.meta.order.slice(),
                matched = '';

                if(selectors){
                    matched = this._matchDimensions(selectors.pop(),this._ac.context,binder,mojitmeta.shaken);
                }//selectorMeta?
            return matched;
        },
        _getMojitRollup: function(mojitName,binder,sel){
            try{
                return this._meta.mojits[mojitName][binder || '*'].shaken[sel];
            }catch(e){
                console.log('ERR founding dimension for:' + mojitName);
                return [];
            }
        },
        _shakeMojits:function(mojits,mojitsDeps){
            var binders = mojitsDeps.filter(function(i){return i.indexOf('/binders/');}),
                shaken = [],
                self = this;
            mojits.forEach(function(mojit){
                var binderName;
                for(var i=0; i< mojitsDeps.length;i++){
                    if(mojitsDeps[i].indexOf(mojit+'/binders/') !== -1){
                        binderName = libpath.basename(mojitsDeps[i],'.js');
                        break;
                    }
                }
                selector = self._matchMojitDimensions(mojit,binderName);
                mojitMatchedRollups = selector ? self._getMojitRollup(mojit,binderName,selector) : [];
                shaken = shaken.concat(mojitMatchedRollups);
            });
            return shaken;
        },
        _getAppRollup: function(selector,action){
            var app = this._meta.app,
                shakedAction = app[action] || app['*'];

            return shakedAction.shaken[selector].slice();
        },
        _shakeApp: function(appDeps){
            var action = this._ac.action,
                app = this._meta.app,
                dimensions = this._ac.context,
                shakenAction = app[action] || app['*'],
                selectors = shakenAction.meta.order.slice(),
                shaken = shakenAction.shaken,
                selector = this._matchDimensions(selectors.pop(),dimensions,action,shaken);
                console.log(selector);
                return this._getAppRollup(selector,action);


        },
        shakeAll: function(meta){
            var ac = this._ac,
                assets = ac.assets.getAssets(),
                topjs = assets.top && assets.top.js || [],
                js = topjs.concat(assets.bottom && assets.bottom.js || []),
                groups = filterAssets(this._app,js),
                loadedMojits = [],rollupsMojits = [],rollupsApp,
                diffArray = function(b,a){
                    return b.filter(function(i) {return !(a.indexOf(i) > -1);});
                };
                //get all mojits
                for(var m in meta.children){
                    var mojit = meta.children[m];
                    loadedMojits.push(mojit.base || mojit.type );
                }

                var app = this._meta.app,
                    hcMojits = (app[ac.action] || app['*']).mojits || [],
                    nonCoveredMojits = diffArray(loadedMojits,hcMojits);

                if(nonCoveredMojits.length){
                    rollupsMojits = this._shakeMojits(nonCoveredMojits,groups.mojits);
                }

                rollupsApp = this._shakeApp(groups.app);

                var all = rollupsApp.concat(rollupsMojits);
                assets.top.css = all;

        },
        shakeList: function(assets,type,location){

        }
    };

    Y.mojito.addons.ac.shaker = ShakerAddon;

}, '0.0.1', {requires: ['mojito']});