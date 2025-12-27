<?php
require_once __DIR__ . '/common/headSecure.php';

$PAGEDATA['pageConfig'] = [
    "TITLE" => "Personal Calendar",
    "BREADCRUMB" => false
];

$calendarConfig = json_decode($AUTH->data['instance']['instances_calendarConfig'], true);
if (!is_array($calendarConfig)) {
    $calendarConfig = [];
}

$PAGEDATA['googleCalendarEmbedUrl'] = $calendarConfig['googleCalendarEmbedUrl'] ?? null;

echo $TWIG->render('personal_calendar.twig', $PAGEDATA);
