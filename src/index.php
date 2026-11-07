<?php
require_once __DIR__ . '/common/headSecure.php';

$PAGEDATA['pageConfig'] = ["TITLE" => "Übersicht", "BREADCRUMB" => false];

if (isset($_GET['i'])) {
    if ($AUTH->serverPermissionCheck("INSTANCES:FULL_PERMISSIONS_IN_INSTANCE")) {
        $_SESSION['instanceID'] = intval($_GET['i']); //It doesn't even bother to verify the instance ID as the user is trusted to be server admins
        header("Location: " . $CONFIG['ROOTURL'] . "?");
    } else {
        $GLOBALS['AUTH']->setInstance($_GET['i']);
        header("Location: " . $CONFIG['ROOTURL'] . "?");
    }
}

if ($AUTH->data['instance']["instancePositions_id"] && $AUTH->data['instance']["cmsPages_id"] != null) {
    $DBLIB->where("instances_id", $AUTH->data['instance']['instances_id']);
    $DBLIB->where("cmsPages_deleted", 0);
    $DBLIB->where("cmsPages_archived", 0);
    $DBLIB->where("(cmsPages_visibleToGroups IS NULL OR (FIND_IN_SET(" . $AUTH->data['instance']["instancePositions_id"] . ", cmsPages_visibleToGroups) > 0))");
    $DBLIB->where("cmsPages_id", $AUTH->data['instance']["cmsPages_id"]);
    $PAGEDATA['PAGE'] = $DBLIB->getOne("cmsPages");
    if ($PAGEDATA['PAGE']) {
        $DBLIB->where("cmsPages_id", $PAGEDATA['PAGE']['cmsPages_id']);
        $DBLIB->orderBy("cmsPagesDrafts_timestamp", "DESC");
        if (isset($_GET['r']) and $AUTH->instancePermissionCheck("CMS:CMS_PAGES:EDIT")) {
            $DBLIB->where("cmsPagesDrafts_id", $_GET['r']);
            $PAGEDATA['specificRevision'] = true;
        }
        $PAGEDATA['PAGE']['DRAFTS'] = $DBLIB->getOne("cmsPagesDrafts", ["cmsPagesDrafts_id", "cmsPagesDrafts_data", "cmsPagesDrafts_revisionID"]);
        if ($PAGEDATA['PAGE']['DRAFTS']) $PAGEDATA['PAGE']['DRAFTS']['cmsPagesDrafts_dataARRAY'] = json_decode($PAGEDATA['PAGE']['DRAFTS']['cmsPagesDrafts_data'], true);

        $DBLIB->insert("cmsPagesViews", [
            "cmsPages_id" => $PAGEDATA['PAGE']['cmsPages_id'],
            "cmsPagesViews_timestamp" => date("Y-m-d H:i:s"),
            "users_userid" => $AUTH->data['users_userid'],
            "cmsPages_type" => 3
        ]);
        if ($AUTH->instancePermissionCheck("BUSINESS:BUSINESS_STATS:VIEW")) $PAGEDATA['WIDGETS'] = new statsWidgets(explode(",", $AUTH->data['users_widgets']), true);
        die($TWIG->render('dashboard-cmsPage.twig', $PAGEDATA));
    }
}

/**
 * Default dashboard, this is not executed if a CMS_PAGE is found above
 */

$PAGEDATA['WIDGETS'] = new statsWidgets(explode(",", $AUTH->data['users_widgets']), false);

if ($AUTH->instancePermissionCheck('PROJECTS:VIEW')) {
    $now = new DateTimeImmutable();
    $today = $now->setTime(0, 0);
    $DBLIB->join('projectsStatuses', 'projectsStatuses.projectsStatuses_id=projects.projectsStatuses_id AND projectsStatuses.instances_id=projects.instances_id', 'LEFT');
    $DBLIB->where('projects.instances_id', $AUTH->data['instance']['instances_id']);
    $DBLIB->where('projects.projects_deleted', 0);
    $DBLIB->where('projects.projects_archived', 0);
    $DBLIB->where('COALESCE(projectsStatuses.projectsStatuses_assetsReleased, 0)', 0);
    $DBLIB->where('projects.projects_dates_use_start', $now->format('Y-m-d H:i:s'), '>=');
    $DBLIB->orderBy('projects.projects_dates_use_start', 'ASC');
    $DBLIB->orderBy('projects.projects_id', 'ASC');
    $PAGEDATA['upcomingEvents'] = $DBLIB->get('projects', 3, ['projects_id', 'projects_name', 'projects_dates_use_start']);
    foreach ($PAGEDATA['upcomingEvents'] as &$event) {
        $start = new DateTimeImmutable($event['projects_dates_use_start']);
        $days = $today->diff($start->setTime(0, 0))->days;
        $event['countdown'] = match ($days) {
            0 => 'Heute',
            1 => 'Morgen',
            default => 'In ' . $days . ' Tagen',
        };
    }
    unset($event);
}

echo $TWIG->render('dashboard.twig', $PAGEDATA);
