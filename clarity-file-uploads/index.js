const Sentry = require('@sentry/node');
const {uploadFile, 
    uploadedFiles, 
    deleteFiles, 
    unattachedCalls, 
    updateFileInfo
} = require('./routes/routes')

const authChecker = require('./middleware/auth');
const multipart = require('parse-multipart-data');
const {AclStorage} = require('@acl/storage')

const Readable = require("stream").Readable;

const aclStorage = new AclStorage()

Sentry.init({
    dsn: 'https://0efe2b16f45d41f79b8836ee7f3cc10b@o507407.ingest.sentry.io/5622860',
    integrations: [
      new Sentry.Integrations.Http({ tracing: true })
    ],
    environment: process.env.ENV,
    autoSessionTracking: true,
    tracesSampleRate: 0.25
  });

module.exports = async function (context, req) {

    const route = req.query.route;

    context.log('JavaScript HTTP trigger function processed a request.');
    const authResult = authChecker.enforceAuthentication(req);
    if(authResult.errored) {
        context.res = {
            status: 401,
            body: {errored: true, message: 'Unauthenticated'}
        }; 
        return;
    } else {
        req.aclAuthentication = authResult;
    }

    const boundary = multipart.getBoundary(req.headers["content-type"]);
    const files = multipart.parse(req.body, boundary);

    let res={};
    let fileInfo={}

    const finfo = files.find((file)=>file.name==='fileInfo')
    const buff = files.find((file)=>file.filename)

    if(finfo){
        fileInfo = JSON.parse(finfo.data.toString()) 
    }

    if( buff){        
        const buffer = buff.data
        var stream = new Readable();
        stream.push(buffer);
        stream.push(null);        
       
    }
    
    let response;
    try {
        if(route==='upload'){ 
            res =  await aclStorage.saveFile({fileInfo, fileStream: stream })
            response = await uploadFile(fileInfo, res)
        }
        else if(route==='uploaded-files'){ 
            response = await uploadedFiles(req, context.res)
            console.log(response)

        }
        else if(route==='updateFileInfo'){ 
            // handle updates without binary data
            if(buff){
                stream.length = buff.data.length
                res =  await aclStorage.uploadRawFile({...fileInfo, fileStream: stream, mimetype: buff.type })
            }
            
            response = await updateFileInfo(req, fileInfo, context.res)

        }
        else if(route==='delete-files'){ 
            response = await deleteFiles(req, context.res)

        }
        else if(route==='unattachedCalls'){ 
            response = await unattachedCalls(req, context.res)

        }
    } catch (error) {
        context.log.error(error);
        Sentry.captureException(error);
    }
    context.res = {
        body: response
    };
}