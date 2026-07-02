const { S3Client, PutObjectCommand, DeleteObjectCommand, HeadBucketCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { GetObjectCommand } = require('@aws-sdk/client-s3');

const REGION = process.env.WASABI_REGION || 'us-east-2';
const BUCKET = process.env.WASABI_BUCKET || 'cygnus-documentos';
const ENDPOINT = process.env.WASABI_ENDPOINT || `https://s3.${REGION}.wasabisys.com`;

let s3Client = null;

function getClient() {
    if (s3Client) return s3Client;
    const accessKey = process.env.WASABI_ACCESS_KEY;
    const secretKey = process.env.WASABI_SECRET_KEY;
    if (!accessKey || !secretKey) {
        throw new Error('WASABI_ACCESS_KEY y WASABI_SECRET_KEY son requeridos.');
    }
    s3Client = new S3Client({
        region: REGION,
        endpoint: ENDPOINT,
        forcePathStyle: true,
        credentials: { accessKeyId: accessKey, secretAccessKey: secretKey }
    });
    return s3Client;
}

async function uploadObject(key, buffer, contentType) {
    const client = getClient();
    await client.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: buffer,
        ContentType: contentType || 'application/octet-stream'
    }));
    return key;
}

async function getSignedObjectUrl(key, expiresIn = 3600) {
    const client = getClient();
    return getSignedUrl(client, new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn });
}

async function deleteObject(key) {
    const client = getClient();
    await client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

async function testConnection() {
    try {
        const client = getClient();
        await client.send(new HeadBucketCommand({ Bucket: BUCKET }));
        return { ok: true, bucket: BUCKET, region: REGION, endpoint: ENDPOINT };
    } catch (e) {
        return { ok: false, error: e.message, bucket: BUCKET, region: REGION };
    }
}

module.exports = {
    BUCKET,
    uploadObject,
    getSignedObjectUrl,
    deleteObject,
    testConnection
};
