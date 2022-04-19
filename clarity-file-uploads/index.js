const {uploadFile, uploadedFiles} = require('./routes/routes')

const authChecker = require('./middleware/auth');
const multipart = require('parse-multipart-data');
const {AclStorage} = require('@acl/storage')

const Readable = require("stream").Readable;






module.exports = async function (context, req) {

    const route = req.query.route

   
    context.log('JavaScript HTTP trigger function processed a request.');
    const auth = authChecker.enforceAuthentication(req, context.res)
    console.log(auth)


    const boundary = multipart.getBoundary(req.headers["content-type"]);
    const files = multipart.parse(req.body, boundary);
    console.log( files[0].data.toString())
    const fileInfo = JSON.parse(files[0].data.toString())    
    const buffer = files[1].data
    var stream = new Readable();
    stream.push(buffer);
    stream.push(null);
    
    const aclStorage = new AclStorage()
    const res =  await aclStorage.saveFile({fileInfo, fileStream: stream })

    console.log(res)

    
    // console.log(req)
    let response;
    if(route==='upload'){ 
        response = await uploadFile(fileInfo, res)
        console.log(response)
    }

    else if(route==='uploaded-files'){ 
        response = await uploadedFiles(req, context.res)
        console.log(response)
    }

    context.res = {
        body: response
    }
}