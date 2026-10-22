<?php
require_once __DIR__ . '/common/headSecure.php';
require_once __DIR__ . '/common/libs/calendar.php';

$PAGEDATA['pageConfig'] = [
    "TITLE" => "Personal Calendar",
    "BREADCRUMB" => false
];

$calendarConfig = json_decode($AUTH->data['instance']['instances_calendarConfig'], true);
if (!is_array($calendarConfig)) {
    $calendarConfig = [];
}

$embedUrl = $calendarConfig['googleCalendarEmbedUrl'] ?? null;
$embedOrigin = calendarEmbedOrigin($embedUrl);
$PAGEDATA['googleCalendarEmbedUrl'] = $embedOrigin ? $embedUrl : null;
if ($embedOrigin and $CONFIG['CSP_ENABLED'] === 'Enabled') {
    // Permit only the configured frame origin on this page, including self-hosted calendars.
    $CSP['frame-src'][] = ['value' => $embedOrigin, 'comment' => 'Configured personal calendar'];
    $policy = [];
    foreach ($CSP as $directive => $sources) {
        $policy[] = $directive . ' ' . implode(' ', array_column($sources, 'value'));
    }
    header('Content-Security-Policy: ' . implode(';', $policy) . ';');
}

echo $TWIG->render('personal_calendar.twig', $PAGEDATA);
