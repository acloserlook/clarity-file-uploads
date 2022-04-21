const os = require("os");
const fs = require("fs");
const path = require("path");
const stream = require("stream");
var multipart = require('parse-multipart');


// const init = require('../helpers/twilio');

const Sentry = require('@sentry/node');

const { AclStorage, MulterAclStorage } = require('@acl/storage');
const aclStorage = new AclStorage();

const multer = require('multer');
const storage = MulterAclStorage();
const upload = multer({ storage });

const busboy = require('busboy');

const AclData = require('@acl/data');
const aclData = new AclData();

const authChecker = require('../middleware/auth');
const responseHelper = require('../helpers/response');

const axios = require('axios');
const Readable = require("stream").Readable;
const memoryStorage = multer.memoryStorage();
const RECEIPT_FILE_TYPE = 1;
const IMAGE_FILE_TYPE = 2;
const AUDIO_FILE_TYPE = 3;

const basePath = 'InsightFolders/Uploads';
const folder = {
  1: `Receipt`,
  2: `Photograph`,
  3: `Audio`
};
const defaultFileShareName = process.env.DEFAULT_STORAGE_FILE_SHARE_NAME || 'insightfolders';

const keyMap = obj => {
  obj = obj || {};
  let keys = Object.keys(obj);
  let keyMap = {};
  keys.forEach(k => {
    keyMap[k.toLocaleLowerCase()] = k;
  });

  return keyMap;
};

const claimDownloadToken = async options => {
  let procedureKey = `acl/DownloadToken_Claim`;

  let { currentUserId, ...input } = options;

  let context = { procedureKey, currentUserId };

  try {
    let result = await aclData.exec(input, context);
    return { success: true, data: result };
  } catch (err) {
    console.log(`Error calling ${procedureKey} with input\n${JSON.stringify(input, null, 2)}\n`, err);
    Sentry.addBreadcrumb({
      type: 'error',
      category: 'Download Tokens',
      message: err.stack,
      level: Sentry.Severity.Error,
    });
    const captureContext = {
      tags: {
        section: "File Uploads",
      }
    }
    Sentry.captureException(err, captureContext);
    let message = process.env.ENV === 'production' ? 'Error executing request' : err.message;
    return { success: false, message };
  }
};

const checkDownloadToken = async req => {
  let authResult = req.aclAuthentication;
  let currentUserId = !authResult.errored ? authResult.currentUserId : null;

  let qsKeyMap = keyMap(req.query);

  let downloadToken = qsKeyMap.downloadtoken ? req.query[qsKeyMap.downloadtoken] : null;
  let downloadTokenValid = false;
  let downloadTokenClaim = null;

  if (downloadToken) {
    let data = { currentUserId, downloadToken };

    let publicKey = req.params.publicKey || null;
    if (publicKey) {
      data.publicKey = publicKey;
    }
  
    let path = req.params['0'] || null;
    if (path) {
      data.path = path;
    }
  
    downloadTokenClaim = await claimDownloadToken(data);
    downloadTokenValid = downloadTokenClaim.success === true && (downloadTokenClaim.data || {}).valid === true;
  }

  return {
    downloadToken,
    downloadTokenValid,
    downloadTokenClaim,
  };
};

const convertStreamToBase64 = stream => {
  return new Promise((resolve, reject) => {
    let buffer = [];
    stream.on('data', chunk => {
      buffer.push(chunk)
    });
    stream.on('end', () => {
      let fileBase64 = Buffer.concat(buffer).toString('base64');
      resolve(fileBase64);
    });
    stream.on('error', error => reject(error));
  });
}

// result transformations not supported
const list=async (req, res) => {
  let body = req.body || null;
  let input = null;
  let options = {};
  if (body && body.data) {
    input = body.data;
    options = body.options || {};
  } else {
    input = body;
  }
  let entities = [];

  try {
    entities = await aclStorage.listDirectory(input.path, 2);
  } catch (err) {
    if (err.statusCode && err.statusCode === 404) {
      console.log(`/file/list: path does not exist: ${input.path}`);
    } else {
      console.log(`/file/list: exception`, err);
    }
  }

  res.status(200).json(entities);
  return;
};


// // result transformations not supported
// router.get('/path/*', async (req, res) => {
//   let authResult = req.aclAuthentication;
//   let currentUserId = !authResult.errored ? authResult.currentUserId : null;

//   let path = req.params['0'] || null;
//   let qsKeyMap = keyMap(req.query);

//   if (!path) {
//     res.status(400).send('Missing path');
//     return;
//   }

//   let {
//     downloadToken,
//     downloadTokenValid,
//     downloadTokenClaim,
//   } = await checkDownloadToken(req);

//   if (downloadToken && !downloadTokenValid) {
//     if (!downloadTokenClaim.success) {
//       console.log(`Exception checking downloadToken: ${downloadTokenClaim.message}`);
//       res.status(500).send('Application exception');
//       return;
//     }
//   }

//   if (!currentUserId && (!downloadToken || !downloadTokenValid)) {
//     switch (authResult.code) {
//       case 'UNAUTHENTICATED':
//         res.status(401).send('Unauthenticated');
//         return;

//       default:
//         console.log(`Unknown auth result: ${JSON.stringify(authResult, null, 2)}`);
//         res.status(401).send('Unauthenticated');
//         return;
//     }
//   }


//   let getFileOpts = { currentUserId };
//   path = path.split('/').filter(p => p);
//   let filename = path.pop();
//   path = path.join('/');
  
//   // TODO: For now assume requests to this end point are for Azure File Share
//   // for quick availability. In the future, perhaps check both File Share and
//   // Blob storage paths in getFile? The client probably shouldn't know or care
//   // the storage type.
//   let fileInfo = {
//     storageTypeId: 2,
//     storagePath: path,
//     storageFilename: filename,
//     defaultFilename: filename,
//   };
  
//   let base64 = req.query[qsKeyMap.base64]; // return raw file as a dataUri
//   let fileTypeId = req.query[qsKeyMap.filetypeid];
//   fileTypeId = parseInt(fileTypeId);
//   let fileStream = await aclStorage.getFile(null, getFileOpts, fileInfo);
//   if(!!base64) {
//     let fileBase64 = await convertStreamToBase64(fileStream);
//     if([RECEIPT_FILE_TYPE, IMAGE_FILE_TYPE].includes(fileTypeId)) {
//       fileBase64 = "data:image/jpeg;base64," + fileBase64;
//     } else if (fileTypeId === AUDIO_FILE_TYPE) {
//       fileBase64 = "data:audio/mp3;base64," + fileBase64;
//     }
//     return res.send(fileBase64);
//   } else {
//     let options = {
//       inline: req.query[qsKeyMap.inline] !== undefined
//     };
//     responseHelper.sendFileStream(fileStream, fileInfo, res, options);
//   }
// });


// // result transformations not supported
// router.get('/:publicKey', async (req, res) => {
//   let authResult = req.aclAuthentication;
//   let currentUserId = !authResult.errored ? authResult.currentUserId : null;

//   let { publicKey } = req.params;
//   let qsKeyMap = keyMap(req.query);

//   if (!publicKey) {
//     res.status(400).send('Missing public key');
//     return;
//   }

//   let {
//     downloadToken,
//     downloadTokenValid,
//     downloadTokenClaim,
//   } = await checkDownloadToken(req);

//   if (downloadToken && !downloadTokenValid) {
//     if (!downloadTokenClaim.success) {
//       console.log(`Exception checking downloadToken: ${downloadTokenClaim.message}`);
//       res.status(500).send('Application exception');
//       return;
//     }
//   }


//   let getFileInfoOpts = { currentUserId };
//   let fileInfo = await aclStorage.getFileInfo(publicKey, getFileInfoOpts);
//   if (!fileInfo) {
//     console.log(`Could not find fileInfo for ${publicKey}`);
//     res.status(404).send('File not found');
//     return;
//   }


//   if (!fileInfo.allowAnonymous && !currentUserId && (!downloadToken || !downloadTokenValid)) {
//     switch (authResult.code) {
//       case 'UNAUTHENTICATED':
//         res.status(401).send('Unauthenticated');
//         return;

//       default:
//         console.log(`Unknown auth result: ${JSON.stringify(authResult, null, 2)}`);
//         res.status(401).send('Unauthenticated');
//         return;
//     }
//   }


//   let getFileOpts = { currentUserId };
//   let fileStream = await aclStorage.getFile(publicKey, getFileOpts);

//   let options = {
//     inline: req.query[qsKeyMap.inline] !== undefined
//   };
//   responseHelper.sendFileStream(fileStream, fileInfo, res, options);
// });


// NOTE, currently, this handler is only good for a single-file upload with a FileInfo json string
// as the value for field fileInfo. Handling muliple files in a single post is possible, but
// the MulterAclStorage engine will need to know how to associate a particular FileInfo in an
// array of FileInfos (fileInfo field) to the file passed to the engine, resulting in multiple
// AclStorage saveFile invocations.
// result transformations not supported
const uploadFile = async (originalFileInfo, savedFileInfo) => {
    // The real work is handled in the storage engine passed to multer (upload)
    // saved FileInfo data is added to the req body as savedFileInfo
    // console.log(req.rawBody)
   


    let jsonResponse = savedFileInfo;

    if (!Array.isArray(originalFileInfo) && Array.isArray(savedFileInfo) && savedFileInfo.length >= 1) {
      jsonResponse = savedFileInfo[0];
    } else if (Array.isArray(originalFileInfo) && !Array.isArray(savedFileInfo)) {
      jsonResponse = [savedFileInfo];
    }

    return jsonResponse;
    // return
};

// create a file stream
const bufferToStream = (buffer) => { 
  if(!Buffer.isBuffer(buffer)) throw new Error('Invalid buffer');
  var stream = new Readable();
  stream.push(buffer);
  stream.push(null);
  return stream;
}

const streamToFile = (inputStream, filePath) => {	
  return new Promise((resolve, reject) => {	
    const fileWriteStream = fs.createWriteStream(filePath, { mode: 0o666 });
    inputStream	
      .pipe(fileWriteStream)	
      .on('finish', resolve)	
      .on('error', reject)	
  })	
}

const streamToBuffer = (stream) => {
  return new Promise((resolve, reject) => {	
    var buffers = []; 
    stream.on("data", function(data) { 
      buffers.push(data); 
    }); 
    stream.on("end", function() { 
      var actualContents = Buffer.concat(buffers); 
      resolve(actualContents);
   });
   stream.on("end", reject);
  });
}

const getUnattachedCalls = async (currentUserId, eventId, shopperId) => {
  let procedureKey = `/api/Authorized/GetTwilioPendingRecordings`;
  let context = { procedureKey, currentUserId };
  let input = {eventId, shopperId};
  let unattachedCalls = await aclData.exec(input, context);

  let newCalls = [];
  if(Array.isArray(unattachedCalls) && unattachedCalls.length > 0) {
    let calls = [];
    let callData = await getFileMetadata(currentUserId, eventId, shopperId, AUDIO_FILE_TYPE);
    if(Array.isArray(callData)) {
      calls = callData.map(x => x.originalFileName);
    }
    
    newCalls = unattachedCalls.filter(recording => {
      if(!calls.includes(recording.twilioPendingRecordingId)) {
        return true;
      } else return false;
    });

    for(let recording of unattachedCalls) {
      const payload = {
        twilioPendingRecordingId: recording.twilioPendingRecordingId
      }
      const procedureKey = `/api/Authorized/DeleteTwilioPendingRecordings`;
      const context = { procedureKey, currentUserId };
      await aclData.exec(payload, context);
    }
  }
  return newCalls;
}

const downloadPendingRecordings = async (currentUserId, eventId, shopperId) => {
  const recordings = await getUnattachedCalls(currentUserId, eventId, shopperId);
  if(Array.isArray(recordings) && recordings.length > 0) {
    for(let i = 0; i < recordings.length; i++) {
      try{
      let recording = recordings[i]
      if(recording.responseHistoryId !== 0) {
        // download from twilio
        let payload = {
          twilioPendingRecordingId:  recording.twilioPendingRecordingId,
          recordingUrl: recording.recordingUrl,
          recorded: recording.recorded,
          responseHistoryId: recording.responseHistoryId
        }

        if(payload.recordingUrl) {
          // save file to files and Azure storage
          let now = new Date();
          let timeTicks = now.getTime() * 10000; // *10000 to replicate current format that use C#
          const fileName = `${payload.responseHistoryId}-${timeTicks}.mp3`;
          const tempPath = os.tmpdir();	
          const filePath = path.normalize(`${tempPath}\\${fileName}`);
          
          const storagePath = 'InsightFolders/Uploads/Audio';
          const storageRoot = aclStorage.getAccountName;
          const fileDescRecorded = recording.recorded.replace(/[^0-9a-z]/gi, '');
          const mimeType = 'audio/mpeg';
          const client = init();
          // fetch call detail
          const callDetails = await client.recordings(recording.twilioPendingRecordingId).fetch();
      
          const fileInfo = {
            storagePath,
            storageRoot,
            mimeType,
            fileDescription: `RecordedCall${fileDescRecorded}`,
            responseHistoryId: payload.responseHistoryId,
            storageFilename: fileName,
            defaultFilename: fileName,
            originalFilename: recording.twilioPendingRecordingId,
            imageCreatedDate: recording.recorded,
            fileTypeId: AUDIO_FILE_TYPE,
            storageTypeId: 2, // save as file share
            callDuration: callDetails.duration
          };

          const procedureKeys = ['acl/Files_Upsert', 'acl/FileInfo_Upsert'];
          for(const procedureKey of procedureKeys) {
            let context = {
              currentUserId,
              procedureKey
            }
           await aclData.exec(fileInfo, context);
          }

          const fStream = await axios({
            url: `${payload.recordingUrl}`,
            method: 'GET',
            responseType: 'stream'
          }); 
          await streamToFile(fStream.data, filePath);
          const fileSize = fs.statSync(filePath).size;
          var readStream = fs.createReadStream(filePath);   
          let fileBuffer = await streamToBuffer(readStream);
          const bufferStream = new stream.Readable({	
              read() {	
                this.push(fileBuffer);	
                this.push(null);	
              }	
            });
          bufferStream.length = fileSize;
          fs.unlinkSync(filePath, error => { console.warn(error); });

          let rawFileParams = {
            fileStream: bufferStream,
            storageFilename: fileName, 
            storageTypeId: 2,
            storagePath,
            mimeType
          }

          await aclStorage.uploadRawFile(rawFileParams);
        }
      }
      } catch (error) {
        console.error(error);
        Sentry.captureException(error);
      }
    }
  }
}

const getFileMetadata = async (currentUserId, eventId, shopperId, fileTypeId) => {
  let procedureKey = `/api/Authorized/GetEventUploads`;
  let context = { procedureKey, currentUserId };
  let input = {eventId, shopperId, fileTypeId};
  let fileMetadata = await aclData.exec(input, context);
  return fileMetadata;                                                                                                                            
}

const uploadedFiles=async (req, res) => {
  const {eventId, shopperId, fileTypeId} = req.body.data;
  let authResult = req.aclAuthentication;
  let currentUserId = !authResult.errored ? authResult.currentUserId : null;
  
  try {
    let result = [];
    await downloadPendingRecordings(currentUserId, eventId, shopperId);
    let fileMetadata = await getFileMetadata(currentUserId, eventId, shopperId, fileTypeId);
    if(!fileMetadata) {
      return res.status(200).json([]);
    } else if(Array.isArray(fileMetadata)) {
      for(let file of fileMetadata) {
        let fileName = file.fileName;
        let directory = `${basePath}/${folder[file.fileTypeId]}`;
        file.url = await aclStorage.generateFileSharedAccessSignatureUri({ directory, fileName, fileTypeId: file.fileTypeId });
        result.push(file);
      }
    }
    return res.status(200).send(result);
  } catch (error) {
    console.error(error);
    Sentry.addBreadcrumb({
      type: 'error',
      category: 'Uploaded Files',
      message: error.stack,
      level: Sentry.Severity.Error,
    });
    const captureContext = {
      tags: {
        section: "File Uploads",
      }
    }
    Sentry.captureException(error, captureContext);

    let message = process.env.ENV === 'production' ? 'Error executing request: Failed to retrieve uploaded files.' : error.message;
    return res.status(500).send({errored: true, message});
  }  
};


const unattachedCalls =async (req, res) => {
  try {
    const {eventId, shopperId} = req.body.data;
    let authResult = req.aclAuthentication;
    let currentUserId = !authResult.errored ? authResult.currentUserId : null;
    // get pending recording file
    await downloadPendingRecordings(currentUserId, eventId, shopperId);
    let result = [];
    const callMetadata = await getFileMetadata(currentUserId, eventId, shopperId, AUDIO_FILE_TYPE);
    if(!callMetadata) {
      return res.status(200).json([]);
    } else if(Array.isArray(callMetadata)) {
      for(let file of callMetadata) {
        let fileName = file.fileName;
        let directory = `${basePath}/${folder[file.fileTypeId]}`;
        file.url = await aclStorage.generateFileSharedAccessSignatureUri({ directory, fileName, fileTypeId: file.fileTypeId });
        result.push(file);
      }
    }
    return res.status(200).send(result);
  } catch (error) {
    console.error(error);
    Sentry.addBreadcrumb({
      type: 'error',
      category: 'Unattached Calls',
      message: error.stack,
      level: Sentry.Severity.Error,
    });
    const captureContext = {
      tags: {
        section: "File Uploads",
      }
    }
    Sentry.captureException(error, captureContext);

    let message = process.env.ENV === 'production' ? 'Error executing request: Failed to attach Call recordings' : error.message;
    return res.status(500).send({errored: true, message});
  }  
};

const updateFileInfo=async (req, fileInfo, res) => {
  try {
   
    const {
      fileId, fileTypeId, 
      fileName,
      fileDescription, 
      fileBase64, 
      width, 
      height, 
      storageFilename, 
      storagePath, 
      displayOrder, 
      ...rest
    } = fileInfo;
    let authResult = req.aclAuthentication;
    let currentUserId = !authResult.errored ? authResult.currentUserId : null;

    let procedureKey = `/api/Authorized/FilesUpsert`;
    let context = { procedureKey, currentUserId };
    let input = {fileId, fileTypeId, fileDescription, width, height, displayOrder};
    let result = await aclData.exec(input, context);

    // if(fileObj) {
    //   let fileStream = bufferToStream(fileObj.buffer);
    //   fileStream.length = fileObj.size;

      // let options = {
      //   ...rest,
      //   storageFilename, 
      //   storagePath,
      //   fileStream,
      //   mimeType: fileObj.mimetype,
      // }
      // await aclStorage.saveFiles({fileInfo, fileStream});
      const newFileUri = await aclStorage.generateFileSharedAccessSignatureUri({ directory: storagePath, fileName: storageFilename, fileTypeId });
      result.url = newFileUri;
    // }

    if([IMAGE_FILE_TYPE, RECEIPT_FILE_TYPE].includes(rest.oldFileTypeId)) {
      let oldDirectoryPath = `${basePath}/${folder[rest.oldFileTypeId]}`;
      let newDirectoryPath = `${basePath}/${folder[fileTypeId]}`;
      let response = await aclStorage.moveFile(oldDirectoryPath, newDirectoryPath, fileName);
      if(response.copyStatus === 'success') result.fileSwapped = true;
    }
    return res.status(200).send(result);
  } catch (error) {
    console.error(error);
    Sentry.addBreadcrumb({
      type: 'error',
      category: 'Update File Info',
      message: error.stack,
      level: Sentry.Severity.Error,
    });
    const captureContext = {
      tags: {
        section: "File Uploads",
      }
    }
    Sentry.captureException(error, captureContext);

    let message = process.env.ENV === 'production' ? 'Error executing request: Failed to update the file information.' : error.message;
    return res.status(500).send({errored: true, message});
  }  
};

const deleteFiles=async (req, res) => {
  const {data} = req.body;
  let fileInfo = data;
  if(!Array.isArray(fileInfo)) fileInfo = [fileInfo];

  try {
    const authResult = req.aclAuthentication;
    const currentUserId = !authResult.errored ? authResult.currentUserId : null;

    let payload = [];
    for(let { fileId, fileName, fileTypeId } of fileInfo) {
      const input = { fileId, fileName, fileTypeId };
      let result = await aclStorage.deleteFile(input, { currentUserId });
      if(result.success) {
        const directory = `${basePath}/${folder[fileTypeId]}`;
        const fileDeleted = await aclStorage.deleteFileInAzureFileShare(directory, fileName);
        payload.push({ file: fileName, fileId, deleted: true });
      } else {
        payload.push({ file: fileName, fileId, deleted: false });
      }
    } 
    return res.status(200).send(payload);
  } catch (error) {
    let text = fileInfo.length > 1 ? 'files' : 'file';
    let message = process.env.ENV === 'production' ? `Error executing request: Failed to delete the selected ${text}.` : error.message;
    return res.status(500).send({errored: true, message});
  }
};

// router.post('/unattachedCalls', authChecker.enforceAuthentication, async (req, res) => {
//   try {
//     const {eventId, shopperId} = req.body.data;
//     let authResult = req.aclAuthentication;
//     let currentUserId = !authResult.errored ? authResult.currentUserId : null;
//     // get pending recording file
//     await downloadPendingRecordings(currentUserId, eventId, shopperId);
//     let result = [];
//     const callMetadata = await getFileMetadata(currentUserId, eventId, shopperId, AUDIO_FILE_TYPE);
//     if(!callMetadata) {
//       return res.status(200).json([]);
//     } else if(Array.isArray(callMetadata)) {
//       for(let file of callMetadata) {
//         let fileName = file.fileName;
//         let directory = `${basePath}/${folder[file.fileTypeId]}`;
//         file.url = await aclStorage.generateFileSharedAccessSignatureUri({ directory, fileName, fileTypeId: file.fileTypeId });
//         result.push(file);
//       }
//     }
//     return res.status(200).send(result);
//   } catch (error) {
//     console.error(error);
//     Sentry.addBreadcrumb({
//       type: 'error',
//       category: 'Unattached Calls',
//       message: error.stack,
//       level: Sentry.Severity.Error,
//     });
//     const captureContext = {
//       tags: {
//         section: "File Uploads",
//       }
//     }
//     Sentry.captureException(error, captureContext);

//     let message = process.env.ENV === 'production' ? 'Error executing request: Failed to attach Call recordings' : error.message;
//     return res.status(500).send({errored: true, message});
//   }  
// });

// router.post('/updateFileInfo', authChecker.enforceAuthentication, multer({storage: memoryStorage}).single('updatedFile'), async (req, res) => {
//   try {
//     const {fileInfo} = req.body;
//     const fileObj = req.file;
//     const {
//       fileId, fileTypeId, 
//       fileName,
//       fileDescription, 
//       fileBase64, 
//       width, 
//       height, 
//       storageFilename, 
//       storagePath, 
//       displayOrder, 
//       ...rest
//     } = JSON.parse(fileInfo);
//     let authResult = req.aclAuthentication;
//     let currentUserId = !authResult.errored ? authResult.currentUserId : null;

//     let procedureKey = `/api/Authorized/FilesUpsert`;
//     let context = { procedureKey, currentUserId };
//     let input = {fileId, fileTypeId, fileDescription, width, height, displayOrder};
//     let result = await aclData.exec(input, context);

//     if(fileObj) {
//       let fileStream = bufferToStream(fileObj.buffer);
//       fileStream.length = fileObj.size;

//       let options = {
//         ...rest,
//         storageFilename, 
//         storagePath,
//         fileStream,
//         mimeType: fileObj.mimetype,
//       }
//       await aclStorage.uploadRawFile(options);
//       const newFileUri = await aclStorage.generateFileSharedAccessSignatureUri({ directory: storagePath, fileName: storageFilename, fileTypeId });
//       result.url = newFileUri;
//     }

//     if([IMAGE_FILE_TYPE, RECEIPT_FILE_TYPE].includes(rest.oldFileTypeId)) {
//       let oldDirectoryPath = `${basePath}/${folder[rest.oldFileTypeId]}`;
//       let newDirectoryPath = `${basePath}/${folder[fileTypeId]}`;
//       let response = await aclStorage.moveFile(oldDirectoryPath, newDirectoryPath, fileName);
//       if(response.copyStatus === 'success') result.fileSwapped = true;
//     }
//     return res.status(200).send(result);
//   } catch (error) {
//     console.error(error);
//     Sentry.addBreadcrumb({
//       type: 'error',
//       category: 'Update File Info',
//       message: error.stack,
//       level: Sentry.Severity.Error,
//     });
//     const captureContext = {
//       tags: {
//         section: "File Uploads",
//       }
//     }
//     Sentry.captureException(error, captureContext);

//     let message = process.env.ENV === 'production' ? 'Error executing request: Failed to update the file information.' : error.message;
//     return res.status(500).send({errored: true, message});
//   }  
// });

// router.post('/delete-files', authChecker.enforceAuthentication, async (req, res) => {
//   const {data} = req.body;
//   let fileInfo = data;
//   if(!Array.isArray(fileInfo)) fileInfo = [fileInfo];

//   try {
//     const authResult = req.aclAuthentication;
//     const currentUserId = !authResult.errored ? authResult.currentUserId : null;

//     let payload = [];
//     for(let { fileId, fileName, fileTypeId } of fileInfo) {
//       const input = { fileId, fileName, fileTypeId };
//       let result = await aclStorage.deleteFile(input, { currentUserId });
//       if(result.success) {
//         const directory = `${basePath}/${folder[fileTypeId]}`;
//         const fileDeleted = await aclStorage.deleteFileInAzureFileShare(directory, fileName);
//         payload.push({ file: fileName, fileId, deleted: true });
//       } else {
//         payload.push({ file: fileName, fileId, deleted: false });
//       }
//     } 
//     return res.status(200).send(payload);
//   } catch (error) {
//     let text = fileInfo.length > 1 ? 'files' : 'file';
//     let message = process.env.ENV === 'production' ? `Error executing request: Failed to delete the selected ${text}.` : error.message;
//     return res.status(500).send({errored: true, message});
//   }
// });


// router.post('/shopper-submitted-photos', authChecker.enforceAuthentication, async (req, res) => {
//   const { shopperId, clientId } = req.body.data;
//   let authResult = req.aclAuthentication;
//   let currentUserId = !authResult.errored ? authResult.currentUserId : null;
//   try {

//     let procedureKey = `acl/getShopperSubmittedPhotos`;
//     let context = { procedureKey, currentUserId };
//     let input = { shopperId, clientId };
//     let shopperPhotos = await aclData.exec(input, context);

//     if(!shopperPhotos) {
//       return res.status(200).json([]);
//     } else if(Array.isArray(shopperPhotos)) {
//       let result = [];
//       for(let file of shopperPhotos) {
//         let directory = `${basePath}/Photograph`;
//         let url = await aclStorage.generateFileSharedAccessSignatureUri({ directory, fileName: file.fileName, fileTypeId: file.fileTypeId });
//         result.push({...file, url});
//       }
//       let potentialDuplicates = [];
//       let uniqueFileNames = new Set(result.map(f => f.originalName));
//       if(uniqueFileNames.size !== result.length) {
//         potentialDuplicates = result.filter(f => {
//           if(uniqueFileNames.has(f.originalName)) {
//             uniqueFileNames.delete(f.originalName);
//           } else if(f.fileId) {
//             return f;
//           }
//         });
//       }

//       let imageList = result.reduce((acc, file) => {
//         let row = acc.find(x => x.locationId === file.locationId);
//         if(!row) {
//           acc.push({
//             locationId: file.locationId,
//             locationName: file.locationName,
//             imageList: [file]
//           });
//         } else {
//           row.imageList.push(file);
//         }
//         return acc;
//       }, []);

//       const payload = {
//         potentialDuplicates,
//         files: imageList
//       }
//       return res.status(200).send(payload);
//     }
//   } catch(error) {
//     let message = process.env.ENV === 'production' ? 'Error executing request: Failed to retrieve uploaded files.' : error.message;
//     return res.status(500).send({errored: true, message});
//   }
// });

// router.post('/email-with-attachment', authChecker.enforceAuthentication, multer({storage: memoryStorage}).single('uploadedFile'), async (req, res) => {
//   try {
//     let { emailDetails }  = req.body;
//     emailDetails = JSON.parse(emailDetails);
//     const storagePath ='InsightFolders/Attachments';

//     let authResult = req.aclAuthentication;
//     let currentUserId = !authResult.errored ? authResult.currentUserId : null;

//     const fileObj = req.file;
//     if(fileObj) {
//       let fileStream = bufferToStream(fileObj.buffer);
//       fileStream.length = fileObj.size;

//       let options = {
//         storagePath,
//         fileStream,
//         storageFilename: fileObj.originalname, 
//         mimeType: fileObj.mimetype,
//         storageTypeId: 2,
//       }
//       const absolutePath = await aclStorage.uploadRawFile(options);
//       if(absolutePath) {
//         emailDetails.attachment1 = absolutePath.replace(/\//g, '\\\\');
//       }
//     }

//     if(emailDetails.attachment2) {
//       const storageRoot = aclStorage.getAccountName;
//       const absolutePath = `/${storageRoot}.file.core.windows.net/${defaultFileShareName}/${storagePath}/${emailDetails.attachment2}`;
//       emailDetails.attachment2 = absolutePath.replace(/\//g, '\\\\');
//     }

//     const procedureKey = `/api/Authorized/EnqueueMailItems`;
//     const context = { procedureKey, currentUserId };
//     const input = { itemList: emailDetails };
//     await aclData.exec(input, context);

//     return res.status(200).send({success: true});
//   } catch(error) {
//     let message = process.env.ENV === 'production' ? 'Error executing request: Failed to send email to shopper.' : error.message;
//     return res.status(500).send({errored: true, message});
//   }
// });

module.exports = {list, uploadFile, uploadedFiles, deleteFiles, unattachedCalls,updateFileInfo};
