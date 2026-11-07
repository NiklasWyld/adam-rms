<?php
require_once __DIR__ . '/../common/headSecure.php';
require_once __DIR__ . '/../common/libs/ProjectInvoicePdf.php';
if (!$AUTH->instancePermissionCheck('PROJECTS:VIEW') || !isset($_GET['id'])) die($TWIG->render('404.twig', $PAGEDATA));
$type = $_GET['type'] ?? 'invoice';
if (!is_string($type) || !isset(ProjectInvoicePdf::TYPES[$type])) {
    http_response_code(404);
    die($TWIG->render('404.twig', $PAGEDATA));
}
require_once __DIR__ . '/../api/projects/data.php';

$business = $AUTH->data['instance'];
$project = $PAGEDATA['project'];
if (!empty($project['clients_id'])) {
    $DBLIB->where('clients_id', $project['clients_id']);
    $DBLIB->where('instances_id', $business['instances_id']);
    $DBLIB->where('clients_deleted', 0);
    if (!$DBLIB->has('clients')) {
        foreach (['name', 'address', 'email', 'phone', 'website'] as $key) $project['clients_' . $key] = '';
        $PAGEDATA['project'] = $project;
    }
}
$document = ProjectInvoicePdf::TYPES[$type];
$finance = $project['projectsTypes_config_finance'] == 1 && $AUTH->instancePermissionCheck('PROJECTS:PROJECT_PAYMENTS:VIEW');
$PAGEDATA['GET'] = ['type' => $type, 'fileType' => $document['title']] + $_GET;
if (!$finance) {
    foreach (['finance', 'prices', 'discounts', 'subHires', 'sales', 'staff'] as $option) {
        $PAGEDATA['GET'][$option] = false;
    }
}
$canStore = $CONFIG['FILES_ENABLED'] === 'Enabled' && $business['instances_storageEnabled'] == 1;
$PAGEDATA['pdfSave'] = $canStore && empty($_GET['draft']);

$DBLIB->where('s3files_meta_type', $document['id']);
$DBLIB->where('instances_id', $business['instances_id']);
$DBLIB->where('s3files_meta_subType', $project['projects_id']);
$PAGEDATA['fileNumber'] = (int)$DBLIB->getValue('s3files', 'count(*)') + 1;

$PAGEDATA['INSTANCELOGO'] = empty($_GET['instancelogo']) ? null : PdfFormat::businessLogo($DBLIB, $bCMS, $business);

if ($type === 'invoice') {
    $invoice = ProjectInvoicePdf::document($_GET, $business, $project, $PAGEDATA['FINANCIALS'], $finance);
    if (!$canStore) $invoice['errors'][] = 'Für eine endgültige Rechnung muss die Dateiablage des Unternehmens aktiviert sein.';
    if ($invoice['number'] !== '') {
        $DBLIB->where('instances_id', $business['instances_id']);
        $DBLIB->where('s3files_invoice_number', $invoice['number']);
        if ($DBLIB->has('s3files')) $invoice['errors'][] = 'Diese Rechnungsnummer wurde bereits verwendet.';
    }
    $PAGEDATA['pdfSave'] = $PAGEDATA['pdfSave'] && !$invoice['errors'];
    if ($PAGEDATA['pdfSave']) {
        // A draft or an unrelated project must not be able to reserve an invoice number.
        $grants = array_filter($_SESSION['projectInvoicePdf'] ?? [], static fn(array $grant) => $grant['expires'] >= time());
        $token = bin2hex(random_bytes(24));
        $grants[$token] = ['project' => (int)$project['projects_id'], 'business' => (int)$business['instances_id'],
            'user' => (int)$AUTH->data['users_userid'], 'number' => $invoice['number'], 'expires' => time() + 1800];
        $_SESSION['projectInvoicePdf'] = array_slice($grants, -20, null, true);
        $PAGEDATA['invoiceToken'] = $token;
    }
    $PAGEDATA['invoicePdf'] = $invoice;
    // The invoice table includes every billing position regardless of the selected annexes.
    $PAGEDATA['GET']['finance'] = false;
    $PAGEDATA['GET']['prices'] = false;
    $PAGEDATA['GET']['discounts'] = false;
}
$PAGEDATA['pdfDraft'] = !empty($_GET['draft']) || ($type === 'invoice' && !$PAGEDATA['pdfSave']);
header('Cache-Control: no-store');
echo $TWIG->render('project/pdf.twig', $PAGEDATA);
