var debug      = require('debug')('win-detect-browsers')
  , execFile   = require('child_process').execFile
  , JSONStream = require('json-stream')
  , duplexify  = require('duplexify')
  , script     = require('path').join(__dirname, 'regListStream.wsf')
  , wbin       = require('windows-bin')
  , writer     = require('flush-write-stream')
  , WIN_EOL    = '\r\n'

function encode(request) {
  var str = request.key + (request.name ? '\t' + request.name : '')
  return escape(str) + WIN_EOL
}

// Always uses agnostic arch, because it's significantly faster.
function createStream () {
  debug('create registry stream')

  var output = JSONStream()
    , duplex = duplexify.obj(null, output)

  // Find the cscript binary. If we're on 64-bit Windows and 32-bit
  // Node.js then prefer the native "Sysnative\cscript.exe", because
  // otherwise we would be redirected to "SysWow64\cscript.exe" and
  // then be unable to access the native registry (without resorting
  // to the slower ExecMethod). See also #18 on GitHub.
  wbin('cscript', function(err, bin) {
    if (err) return duplex.destroy(err)

    var input = writer.obj(function write(request, _, next) {
      if (!request || !request.key) return next()
      if (child.stdin.write(encode(request))===false) child.stdin.once('drain', next)
      else next()
    }, function flush(cb) {
      if (child.stdin.writable) child.stdin.write(WIN_EOL, cb)
      else cb()
    })

    var child = execFile(bin, ['//Nologo', script], function done(err) {
      if (err) duplex.destroy(err)
    })

    child.stdout.pipe(output)
    duplex.setWritable(input)
  })

  // Errors from input and output bubble to duplex
  duplex.on('error', debug)

  return duplex;
}

module.exports = function() {
  var pending = []
  var stream = createStream()
    .on('close', finish).on('finish', finish)

  function finish(){
    pending = pending.filter(function(request){
      request.cb(new Error('Stream ended'))
      return false
    })
  }

  stream.on('data', function(row){
    while(pending.length) {
      var request = pending.shift()
      if (row.key===request.key && row.name==request.name) {
        request.cb(null, row.data, request.key)
        break
      } else {
        debug('Unknown row: %s /v %s', row.key, row.name)
        request.cb(new Error('Missing data'))
      }
    }
  })

  // If valueName is empty, the key's default value is returned
  stream.query = function (key, valueName, cb) {
    if (typeof key != 'string') key = key.join('\\')
    var request = {key: key, name: valueName || '', cb: cb}
    pending.push(request)
    stream.write(request);
  }

  return stream;
}
