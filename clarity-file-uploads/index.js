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




module.exports = async function (context, req) {

    const route = req.query.route

   
    context.log('JavaScript HTTP trigger function processed a request.');
    const auth = authChecker.enforceAuthentication(req, context.res)
    // console.log(auth)

    // console.log(req)

    const boundary = multipart.getBoundary(req.headers["content-type"]);
    const files = multipart.parse(req.body, boundary);

    // console.log(files)

    let res={};
    let fileInfo={}

   
    const finfo = files.find((file)=>file.name==='fileInfo')
    const buff = files.find((file)=>file.filename)

    console.log(buff)
    console.log(finfo)

    if(finfo){
        fileInfo = JSON.parse(finfo.data.toString()) 
        console.log(fileInfo)
    }

    if( buff){
        
        const buffer = buff.data
        var stream = new Readable();
        stream.push(buffer);
        stream.push(null);
        
       
    }
    
    
    
    

    
    // console.log(req)
    let response;
    if(route==='upload'){ 
        
        res =  await aclStorage.saveFile({fileInfo, fileStream: stream })
    
        console.log(res)
        response = await uploadFile(fileInfo, res)
        console.log(response)
    }

    else if(route==='uploaded-files'){ 
        response = await uploadedFiles(req, context.res)
        console.log(response)
    }
    else if(route==='updateFileInfo'){ 
        stream.length = buff.data.length
        res =  await aclStorage.uploadRawFile({...fileInfo, fileStream: stream, mimetype: buff.type })

        console.log(res)

        response = await updateFileInfo(req, fileInfo, context.res)
        console.log(response)
    }
    else if(route==='delete-files'){ 
        response = await deleteFiles(req, context.res)
        console.log(response)
    }
    else if(route==='unattachedCalls'){ 
        response = await unattachedCalls(req, context.res)
        console.log(response)
    }

    context.res = {
        body: response
    }
}