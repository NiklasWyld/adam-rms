<?php
require_once __DIR__ . '/../apiHeadSecure.php';
require_once __DIR__ . '/../../common/libs/ProjectInvoicePdf.php';

$business = (int)$AUTH->data['instance']['instances_id'];
$id = filter_var($_POST['id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
$version = filter_var($_POST['fileNumber'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
$type = $_POST['type'] ?? null;
if (!$AUTH->instancePermissionCheck('PROJECTS:VIEW') || !$id || !$version || !is_string($type) ||
    !isset(ProjectInvoicePdf::TYPES[$type]) || $CONFIG['FILES_ENABLED'] !== 'Enabled' ||
    $AUTH->data['instance']['instances_storageEnabled'] != 1) finish(false);

$DBLIB->where('instances_id', $business);
$DBLIB->where('projects_deleted', 0);
$DBLIB->where('projects_id', $id);
if (!$DBLIB->has('projects')) finish(false);

$number = null;
if ($type === 'invoice') {
    $token = $_POST['invoiceToken'] ?? '';
    $grant = is_string($token) ? ($_SESSION['projectInvoicePdf'][$token] ?? null) : null;
    if (!$AUTH->instancePermissionCheck('PROJECTS:PROJECT_PAYMENTS:VIEW') || !$grant ||
        $grant['expires'] < time() || $grant['business'] !== $business || $grant['project'] !== $id ||
        $grant['user'] !== (int)$AUTH->data['users_userid']) {
        finish(false, ['code' => 'INVOICE-VALIDATION', 'message' => 'Die Rechnung konnte nicht geprüft werden. Bitte erzeuge sie erneut.']);
    }
    $number = $grant['number'];
}

$file = $_FILES['file'] ?? null;
if (!$file || $file['error'] !== UPLOAD_ERR_OK || !is_uploaded_file($file['tmp_name']) ||
    (new finfo(FILEINFO_MIME_TYPE))->file($file['tmp_name']) !== 'application/pdf') {
    finish(false, ['code' => 'PDF-UPLOAD', 'message' => 'Die übermittelte Datei ist kein gültiges PDF.']);
}

$document = ProjectInvoicePdf::TYPES[$type];
$filename = $document['file'] . '-' . bin2hex(random_bytes(16));
$key = $document['path'] . '/' . $filename . '.pdf';
$bucket = $CONFIGCLASS->get('AWS_S3_BUCKET');
$s3 = new Aws\S3\S3Client([
    'version' => 'latest',
    'region' => $CONFIGCLASS->get('AWS_S3_REGION'),
    'endpoint' => $CONFIGCLASS->get('AWS_S3_SERVER_ENDPOINT'),
    'use_path_style_endpoint' => $CONFIGCLASS->get('AWS_S3_ENDPOINT_PATHSTYLE') === 'Enabled',
    'credentials' => [
        'key' => $CONFIGCLASS->get('AWS_S3_KEY'),
        'secret' => $CONFIGCLASS->get('AWS_S3_SECRET'),
    ],
]);

// Reserve the invoice number with the file row before uploading. A failed upload releases it.
$DBLIB->startTransaction();
$stored = false;
try {
    $fileId = $DBLIB->insert('s3files', [
        's3files_extension' => 'pdf',
        's3files_path' => $document['path'],
        's3files_meta_size' => $file['size'],
        's3files_meta_type' => $document['id'],
        's3files_meta_subType' => $id,
        'users_userid' => $AUTH->data['users_userid'],
        's3files_original_name' => $document['file'] . '.pdf',
        's3files_filename' => $filename,
        's3files_name' => 'v' . $version,
        's3files_meta_public' => 0,
        'instances_id' => $business,
        's3files_invoice_number' => $number,
    ]);
    if (!$fileId) {
        $duplicate = $number !== null && (int)$DBLIB->getLastErrno() === 1062;
        $DBLIB->rollback();
        finish(false, ['code' => 'PDF-SAVE', 'message' => $duplicate ?
            'Diese Rechnungsnummer wurde bereits verwendet.' : 'Der Dateieintrag konnte nicht angelegt werden.']);
    }
    $s3->putObject(['Bucket' => $bucket, 'Key' => $key, 'SourceFile' => $file['tmp_name'], 'ContentType' => 'application/pdf']);
    $stored = true;
    if (!$DBLIB->commit()) throw new RuntimeException('PDF file entry could not be committed.');
} catch (Throwable $error) {
    $DBLIB->rollback();
    if ($stored) {
        try { $s3->deleteObject(['Bucket' => $bucket, 'Key' => $key]); }
        catch (Throwable $cleanupError) { error_log('Project PDF cleanup failed.'); }
    }
    error_log('Project PDF upload failed: ' . get_class($error));
    finish(false, ['code' => 'PDF-SAVE', 'message' => 'Das PDF konnte nicht gespeichert werden.']);
}
if ($number !== null) unset($_SESSION['projectInvoicePdf'][$token]);
finish(true, null, ['id' => $fileId, 'resize' => false, 'url' => $CONFIG['ROOTURL'] . '/api/file/?r=true&f=' . $fileId]);
/** @OA\Post(
 *     path="/s3files/uploadProjectInvoice.php", 
 *     summary="Upload Project Invoice", 
 *     description="Upload a project invoice  
Requires Instance Permission PROJECTS:VIEW. Invoices additionally require finance access and a valid export token.
", 
 *     operationId="uploadProjectInvoice", 
 *     tags={"s3files"}, 
 *     @OA\Response(
 *         response="200", 
 *         description="Success",
 *         @OA\MediaType(
 *             mediaType="application/json", 
 *             @OA\Schema( 
 *                 type="object", 
 *                 @OA\Property(
 *                     property="result", 
 *                     type="boolean", 
 *                     description="Whether the request was successful",
 *                 ),
 *             ),
 *         ),
 *     ), 
 *     @OA\Parameter(
 *         name="id",
 *         in="query",
 *         description="Project ID",
 *         required="true", 
 *         @OA\Schema(
 *             type="number"), 
 *         ), 
 *     @OA\Parameter(
 *         name="type",
 *         in="query",
 *         description="What type of file is this - invoice, quote or delivery note?",
 *         required="true", 
 *         @OA\Schema(
 *             type="string"), 
 *         ), 
 *     @OA\Parameter(
 *         name="file",
 *         in="files",
 *         description="File",
 *         required="true", 
 *         ), 
 *     @OA\Parameter(
 *         name="fileNumber",
 *         in="query",
 *         description="File Version Number",
 *         required="true", 
 *         @OA\Schema(
 *             type="number"), 
 *         ), 
 * )
 */
