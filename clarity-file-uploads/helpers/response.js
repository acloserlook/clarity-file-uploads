const { Readable, Stream } = require('stream');

const sendFileStream = (fileStream, fileInfo, res, options) => {
  if (!fileStream) {
    console.log(`Could not find fileStream for ${JSON.stringify(fileInfo, null, 2)}`);
    res.status(404).send('File not found');
    return;
  }

  if (typeof fileStream === 'string') {
    fileStream = Readable.from([fileStream]);
  }
  if (!(fileStream instanceof Stream)) {
    fileStream = Readable.from(fileStream);
  }

  options = options || {};
  fileInfo = fileInfo || {};

  res.status(200);
  if (fileInfo.mimeType) {
    res.setHeader('Content-type', fileInfo.mimeType);
  }

  res.attachment(fileInfo.defaultFilename);
  if (options.inline) {
    res.set('Content-Disposition', 'inline');
  }

  if (fileInfo.fileSize) {
    res.setHeader('Content-length', fileInfo.fileSize);
  }

  fileStream.pipe(res);
};


const jsonStringify = (value, replacer, spaces, escape) => {
  // v8 checks arguments.length for optimizing simple call
  // https://bugs.chromium.org/p/v8/issues/detail?id=4730
  var json = replacer || spaces
    ? JSON.stringify(value, replacer, spaces)
    : JSON.stringify(value);

  if (escape) {
    json = json.replace(/[<>&]/g, function (c) {
      switch (c.charCodeAt(0)) {
        case 0x3c:
          return '\\u003c';
        case 0x3e:
          return '\\u003e';
        case 0x26:
          return '\\u0026';
        /* istanbul ignore next: unreachable default */
        default:
          return c;
      }
    });
  }

  return json;
}


module.exports = {
  jsonStringify,
  sendFileStream,
};