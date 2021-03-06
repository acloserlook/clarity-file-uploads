const stream = require("stream");
const init = require('../helpers/twilio');
const Sentry = require('@sentry/node');
const { AclStorage } = require('@acl/storage');
const aclStorage = new AclStorage();
const AclData = require('@acl/data');
const aclData = new AclData();
const axios = require('axios');
const RECEIPT_FILE_TYPE = 1;
const IMAGE_FILE_TYPE = 2;
const AUDIO_FILE_TYPE = 3;

const basePath = 'InsightFolders/Uploads';
const folder = {
  1: `Receipt`,
  2: `Photograph`,
  3: `Audio`
};

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
  
  return entities;
};


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
          
          const storagePath = 'InsightFolders/Uploads/Audio';
          const storageRoot = aclStorage.getAccountName;
          const fileDescRecorded = recording.recorded.replace(/[^0-9a-z]/gi, '');
          const mimeType = 'audio/mpeg';
          const client = init();
          // fetch call detail
          const callDetails = await client.recordings(recording.twilioPendingRecordingId).fetch();

          if(callDetails.duration === -1){
            callDetails.duration = 0;
          }
      
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
            try {
              let context = {
                currentUserId,
                procedureKey
              }
             await aclData.exec(fileInfo, context);
            } catch(error) {
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
            }
          }

          const fStream = await axios({
            url: `${payload.recordingUrl}`,
            method: 'GET',
            responseType: 'stream'
          }); 
          let fileBuffer = await streamToBuffer(fStream.data);
          const bufferStream = new stream.Readable({	
              read() {	
                this.push(fileBuffer);	
                this.push(null);	
              }	
            });
          bufferStream.length = fileBuffer.length;

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
    if(Array.isArray(fileMetadata)) {
      for(let file of fileMetadata) {
        let fileName = file.fileName;
        let directory = `${basePath}/${folder[file.fileTypeId]}`;
        file.url = await aclStorage.generateFileSharedAccessSignatureUri({ directory, fileName, fileTypeId: file.fileTypeId });
        result.push(file);
      }
    }
    return result;
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
    return {errored: true, message};
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
    if(Array.isArray(callMetadata)) {
      for(let file of callMetadata) {
        let fileName = file.fileName;
        let directory = `${basePath}/${folder[file.fileTypeId]}`;
        file.url = await aclStorage.generateFileSharedAccessSignatureUri({ directory, fileName, fileTypeId: file.fileTypeId });
        result.push(file);
      }
    }
    return result;
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
    return {errored: true, message};
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
    const newFileUri = await aclStorage.generateFileSharedAccessSignatureUri({ directory: storagePath, fileName: storageFilename, fileTypeId });
    result.url = newFileUri;
    if([IMAGE_FILE_TYPE, RECEIPT_FILE_TYPE].includes(rest.oldFileTypeId)) {
      let oldDirectoryPath = `${basePath}/${folder[rest.oldFileTypeId]}`;
      let newDirectoryPath = `${basePath}/${folder[fileTypeId]}`;
      let response = await aclStorage.moveFile(oldDirectoryPath, newDirectoryPath, fileName);
      if(response.copyStatus === 'success') result.fileSwapped = true;
    }
    return result;
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
    return {errored: true, message};
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
        payload.push({ file: fileName, fileId, deleted: true });
      } else {
        payload.push({ file: fileName, fileId, deleted: false });
      }
    } 
    return payload;
  } catch (error) {
    let text = fileInfo.length > 1 ? 'files' : 'file';
    let message = process.env.ENV === 'production' ? `Error executing request: Failed to delete the selected ${text}.` : error.message;
    return {errored: true, message};
  }
};

module.exports = {list, uploadFile, uploadedFiles, deleteFiles, unattachedCalls,updateFileInfo};
