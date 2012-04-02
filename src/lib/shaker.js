var path = require('path'),
    utils = require('mojito/lib/management/utils'),
    fs = require('fs'),
    ResourceStore = require('mojito/lib/store.server'),
    Queue = require('buildy').Queue,
    Registry = require('buildy').Registry,
    ShakerCore = require('./core').Shaker,
    async = require('async');

function Rollup() {
    this._js = [];
    this._css = [];
}

Rollup.prototype = {
    addJS: function(file) {
        this._js.push(file);
    },

    setJS: function(files) {
        this._js = files;
    },

    processJS: function(name, callback) {
        this._process(name, this._js, '.js', callback);
    },

    addCSS: function(file) {
        this._css.push(file);
    },

    setCSS: function(files) {
        this._css = files;
    },

    processCSS: function(name, callback) {
        this._process(name, this._css, '.css', callback);
    },

    _process: function(name, files, ext, callback) {
        var registry = new Registry();
        registry.load(__dirname + '/tasks/checksumwrite.js');
        var queue = new Queue('MojitoRollup', {registry: registry});

        queue.on('taskComplete', function(data) {
            if (data.task.type === 'checksumwrite') {
                callback(data.result);
            }
        });

        queue.task('files', files)
            .task('concat')
            .task(ext === '.js' ? 'jsminify' : 'cssminify')
            .task('checksumwrite', {name: name + '_{checksum}' + ext})
            .run();
    }
};

function Shaker(options) {
    var opts = options || {};
    this._root = opts.root || process.cwd();
    this._stage = opts.stage || false;
}

Shaker.prototype = {
    run: function() {
        this.rollupMojito();

        var shaker = new ShakerCore({root: './'});
        utils.log('[SHAKER] - Analizying application assets to Shake... ');
        shaker.shakeAll(this.onShake.bind(this));
    },

    rollupMojito: function() {
        var store = new ResourceStore(this._root),
            rollup = new Rollup(),
            files;

        store.preload();
        files = store.getRollupsApp('client', {}).srcs;

        files.forEach(function(file) {
            // Skip the app level files (Note: to override path: substr(this._root.length + 1);)
            if (this._root !== file.substr(0, this._root.length)) {
                rollup.addJS(file);
            }
        }, this);

        rollup.processJS('assets/mojito/mojito_rollup_full', function(filename) {
            utils.log('[SHAKER] - Created rollup for mojito-core in: ' + filename);
        });
    },

    onShake: function(shaken) {
        if (this._stage) {
            utils.log('[SHAKER] - Minifying and optimizing rollups...');
            this.compress(shaken, this.writeMetaData);
        } else {
            utils.log('[SHAKER] - Processing assets for development env.');
            this.rename(shaken, this.writeMetaData);
        }
    },

    rename: function(shaken,callback){
        var mojit,mojits,action,actions,dim,list,actionName,dimensions,item,
            app = path.basename(process.cwd());
        for(mojit in (mojits = shaken.mojits)){
            for(action in (actions = mojits[mojit])){
                for(dim in (dimensions = actions[action].shaken)){
                    for(item in (list = dimensions[dim])){
                        list[item] = list[item].replace('./mojits','/static');
                    }
                }
            }
        }
        for(action in (actions = shaken.app)){
            for(dim in (dimensions = actions[action].shaken)){
                for(item in (list = dimensions[dim])){
                        var tmp = list[item];
                        tmp = tmp.replace('./mojits/','/static/');
                        tmp = tmp.replace('./','/static/'+app+'/');
                        //console.log(list[item] + '=>' + tmp);
                        list[item] = tmp;
                }
            }
        }
        callback(shaken);
    },

    _flattenMetaData: function(metadata) {
        var mojit, action, dim, flattened = [];

        for (mojit in metadata.mojits) {
            for (action in metadata.mojits[mojit]) {
                for (dim in metadata.mojits[mojit][action].shaken) {
                    flattened.push({type: 'mojit', name: mojit, action: action, dim: dim, list: metadata.mojits[mojit][action].shaken[dim], meta: metadata.app[action].meta});
                }
            }
        }

        for (action in metadata.app) {
            for (dim in metadata.app[action].shaken) {
                flattened.push({type: 'app', name: 'app', action: action, dim: dim, list: metadata.app[action].shaken[dim], meta: metadata.app[action].meta, app_mojits: metadata.app[action].mojits});
            }
        }

        return flattened;
    },

    _unflattenMetaData: function(flattened) {
        var metadata = {};

        flattened.forEach(function(item) {
            if (item.type == 'mojit') {
                if (!metadata.mojits) {
                    metadata.mojits = {};
                }
                if (!metadata.mojits[item.name]) {
                    metadata.mojits[item.name] = {};
                }
                if (!metadata.mojits[item.name][item.action]) {
                    metadata.mojits[item.name][item.action] = {shaken: {}, meta: {}};
                }
                if (!metadata.mojits[item.name][item.action].shaken[item.dim]) {
                    metadata.mojits[item.name][item.action].shaken[item.dim] = [];
                }

                metadata.mojits[item.name][item.action].shaken[item.dim] = item.list;
                metadata.mojits[item.name][item.action].meta = item.meta;
            }
            else if (item.type == 'app') {
                if (!metadata.app) {
                    metadata.app = {};
                }
                if (!metadata.app[item.action]) {
                    metadata.app[item.action] = {shaken: {}, meta: {}};
                }
                if (!metadata.app[item.action].shaken[item.dim]) {
                    metadata.app[item.action].shaken[item.dim] = [];
                }

                metadata.app[item.action].shaken[item.dim] = item.list;
                metadata.app[item.action].meta = item.meta;
                metadata.app[item.action].mojits = item.app_mojits;
            }
        });

        return metadata;
    },

    compress: function(metadata, compressed) {
        var app = path.basename(this._root);
        var items = this._flattenMetaData(metadata);

        async.forEach(items, function(item, callback) {
            if (!item.list.length) {
                callback();
                return;
            }
            
            var rollup = new Rollup();
            rollup.setCSS(item.list);
            var name = 'assets/r/' + item.name + '_' + (item.action == '*' ? 'default' : item.action) + '_' + item.dim;
            rollup.processCSS(name, function(filename) {
                item.list = ['/static/' + app + '/' + filename];
                callback();
            });
        }, function(err) {
            compressed(this._unflattenMetaData(items));
        }.bind(this));
    },
    
    writeMetaData: function(shaken) {
        utils.log('[SHAKER] - Writing processed metadata in autoload.');
         var aux = "";
            aux+= 'YUI.add("shaker/metaMojits", function(Y, NAME) { \n';
            aux+= 'YUI.namespace("_mojito._cache.shaker");\n';
            aux+= 'YUI._mojito._cache.shaker.meta = \n';
            aux += JSON.stringify(shaken,null,'\t');
            aux+= '});';
        fs.writeFile('autoload/compiled/shaker/shaker-meta.server.js',aux);
    }
};

exports.Shaker = Shaker;