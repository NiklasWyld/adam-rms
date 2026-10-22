<?php
require_once __DIR__ . '/../apiHeadSecure.php';
require_once __DIR__ . '/../../common/libs/calendar.php';

if (!$AUTH->instancePermissionCheck("BUSINESS:BUSINESS_SETTINGS:EDIT")) {
    finish(false, ["code" => "AUTH-ERROR", "message" => "No auth for action"]);
}
if (!isset($_POST['formData']) or !is_array($_POST['formData'])) {
    finish(false, ["code" => "PARAM-ERROR", "message" => "Calendar settings are required"]);
}
$oldData = json_decode($AUTH->data['instance']['instances_calendarConfig'], true);
if (!is_array($oldData)) $oldData = [];
// An unchecked HTML checkbox is absent from serializeArray(). Keep extension keys,
// but explicitly clear the three checkboxes when saving the settings form.
$checkboxes = ['showProjectStatus', 'showSubProjects', 'useCustomWeekNumbers'];
$newData = array_merge($oldData, array_fill_keys($checkboxes, false));
foreach ($_POST['formData'] as $item) {
    if (!is_array($item) or !isset($item['name'], $item['value']) or !is_string($item['name']) or !is_scalar($item['value'])) {
        finish(false, ["code" => "PARAM-ERROR", "message" => "Invalid calendar settings"]);
    }
    $name = $item['name'];
    $value = (string) $item['value'];
    if (in_array($name, $checkboxes, true)) {
        $newData[$name] = in_array($value, ['on', '1', 'true'], true);
    } elseif ($name === 'defaultView') {
        if (!in_array($value, ['dayGridMonth', 'timeGridWeek', 'timeGridDay', 'listWeek'], true)) {
            finish(false, ["code" => "PARAM-ERROR", "message" => "Invalid calendar view"]);
        }
        $newData[$name] = $value;
    } elseif ($name === 'googleCalendarEmbedUrl') {
        $value = trim($value);
        if ($value !== '' and (strlen($value) > 4096 or calendarEmbedOrigin($value) === null)) {
            finish(false, ["code" => "PARAM-ERROR", "message" => "Use a valid HTTPS calendar embed URL without login credentials"]);
        }
        $newData[$name] = $value === '' ? null : $value;
    }
}
$DBLIB->where("instances_id", $AUTH->data['instance']['instances_id']);
if (!$DBLIB->update("instances", ["instances_calendarConfig" => json_encode($newData)])) {
    finish(false, ["code" => "UPDATE-FAIL", "message" => "Could not update instance calendar config"]);
}
$bCMS->auditLog("EDIT-INSTANCE", "instances", "Calendar - " . json_encode($newData), $AUTH->data['users_userid'], null, null, $AUTH->data['instance']['instances_id']);
finish(true);

/**
 *  @OA\Post(
 *      path="/instances/editCalendarSettings.php",
 *      summary="Edit Calendar Settings",
 *      description="Edit Settings related to calendars, including formatting and filters",
 *      operationId="editCalendarSettings",
 *      tags={"instanceCalendarSettings"},
 *      @OA\Response(
 *          response="200",
 *          description="Success",
 *          @OA\MediaType(
 *             mediaType="application/json",
 *             @OA\Schema(ref="#/components/schemas/SimpleResponse"),
 *         ),
 *      ),
 *      @OA\Parameter(
 *          name="formData",
 *          in="query",
 *          description="Calendar Options",
 *          required="true",
 *          @OA\Schema(
 *              type="object",
 *          ),
 *      ),
 *  )
 */
