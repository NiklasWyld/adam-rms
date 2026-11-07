<?php
declare(strict_types=1);

final class ShiftPlanning
{
    public function __construct(private $db, private int $instance) {}

    public static function id($value): int
    {
        if ((!is_int($value) && !is_string($value)) || !preg_match('/^[1-9][0-9]{0,9}$/D', (string)$value) || (int)$value > 2147483647) {
            throw new InvalidArgumentException('Ungültige ID.');
        }
        return (int)$value;
    }

    private static function text($value, int $max, bool $required = false): string
    {
        if (!is_string($value) || !mb_check_encoding($value, 'UTF-8') || mb_strlen($value) > $max ||
            preg_match('/[\x00-\x08\x0B\x0C\x0E-\x1F]/', $value) || ($required && trim($value) === '')) {
            throw new InvalidArgumentException('Bitte gib einen gültigen Text mit höchstens ' . $max . ' Zeichen ein.');
        }
        return trim($value);
    }

    private static function date($value): string
    {
        // Project dates are stored and displayed in the configured AdamRMS timezone.
        $date = is_string($value) && preg_match('/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}$/D', $value) ? DateTimeImmutable::createFromFormat('!Y-m-d\TH:i', $value) : false;
        if (!$date || $date->format('Y-m-d\TH:i') !== $value || $date->format('Y') < '1000') {
            throw new InvalidArgumentException('Bitte gib ein gültiges Datum und eine gültige Uhrzeit ein.');
        }
        return $date->format('Y-m-d H:i:s');
    }

    private function project(int $project, bool $lock = false): array
    {
        $this->db->where('instances_id', $this->instance);
        $this->db->where('projects_id', $project);
        $this->db->where('projects_deleted', 0);
        if ($lock) $this->db->setQueryOption('FOR UPDATE');
        $row = $this->db->getOne('projects', ['projects_id', 'projects_name', 'projects_archived', 'projects_dates_use_start', 'projects_dates_use_end']);
        if (!$row) throw new OutOfBoundsException('Projekt nicht gefunden.');
        return $row;
    }

    private function members(?array $ids = null): array
    {
        $this->db->join('instancePositions', 'instancePositions.instancePositions_id=userInstances.instancePositions_id', 'INNER');
        $this->db->join('users', 'users.users_userid=userInstances.users_userid', 'INNER');
        $this->db->where('instancePositions.instances_id', $this->instance);
        $this->db->where('userInstances_deleted', 0);
        $this->db->where('(userInstances_archived IS NULL OR userInstances_archived >= ?)', [date('Y-m-d H:i:s')]);
        $this->db->where('users_deleted', 0);
        if ($ids !== null) $this->db->where('users.users_userid', $ids, 'IN');
        $this->db->orderBy('users_name1', 'ASC');
        $this->db->orderBy('users_name2', 'ASC');
        $this->db->orderBy('users.users_userid', 'ASC');
        $members = [];
        foreach ($this->db->get('userInstances', null, ['users.users_userid AS id', "CONCAT(users_name1, ' ', users_name2) AS name"]) as $row) {
            $members[$row['id']] = ['id' => (int)$row['id'], 'name' => trim($row['name'])];
        }
        return $members;
    }

    public function document(int $project, bool $canEdit = false, bool $showConflicts = true): array
    {
        $this->db->startTransaction();
        try {
            $record = $this->project($project);
            $editable = $canEdit && !$record['projects_archived'];
            $this->scope($project);
            $this->db->where('projectShifts_deleted', 0);
            $this->db->orderBy('projectShifts_start', 'ASC');
            $this->db->orderBy('projectShifts_id', 'ASC');
            $shifts = [];
            foreach ($this->db->get('projectShifts') as $row) {
                $id = (int)$row['projectShifts_id'];
                $shifts[$id] = [
                    'id' => $id, 'revision' => (int)$row['projectShifts_revision'], 'title' => $row['projectShifts_title'],
                    'start' => substr(str_replace(' ', 'T', $row['projectShifts_start']), 0, 16),
                    'end' => substr(str_replace(' ', 'T', $row['projectShifts_end']), 0, 16),
                    'tasks' => $row['projectShifts_tasks'], 'meetingPoint' => $row['projectShifts_meetingPoint'],
                    'notes' => $row['projectShifts_notes'], 'assignments' => [],
                ];
            }
            if ($shifts) {
                foreach ($this->assignments($project, $showConflicts) as $row) {
                    $shifts[$row['shiftId']]['assignments'][] = [
                        'id' => (int)$row['memberId'], 'name' => $row['memberName'] ?: 'Ehemaliges Mitglied',
                        'role' => $row['role'], 'overlap' => (bool)$row['overlap'],
                    ];
                }
            }
            $members = $editable ? array_values($this->members()) : [];
            if (!$this->db->commit()) throw new RuntimeException('Shift read transaction failed.');
        } catch (Throwable $error) {
            $this->db->rollback();
            throw $error;
        }
        return ['project' => $record, 'shifts' => array_values($shifts), 'editable' => $editable, 'members' => $members];
    }

    private function assignments(int $project, bool $showConflicts): array
    {
        // Return only a flag for other projects. The matching project and shift details stay private.
        $conflict = $showConflicts ? <<<'SQL'
EXISTS (
    SELECT 1
    FROM projectShiftAssignments AS otherAssignment
    JOIN projectShifts AS otherShift ON otherShift.projectShifts_id = otherAssignment.projectShifts_id
    JOIN projects AS otherProject ON otherProject.projects_id = otherShift.projects_id AND otherProject.instances_id = otherShift.instances_id
    LEFT JOIN projectsStatuses AS otherStatus ON otherStatus.projectsStatuses_id = otherProject.projectsStatuses_id AND otherStatus.instances_id = otherProject.instances_id
    WHERE otherAssignment.users_userid = assignment.users_userid AND otherAssignment.projectShiftAssignments_deleted = 0
      AND otherShift.instances_id = shift.instances_id AND otherShift.projectShifts_deleted = 0
      AND otherProject.projects_deleted = 0
      AND (otherShift.projects_id = shift.projects_id OR (
          otherProject.projects_archived = 0 AND COALESCE(otherStatus.projectsStatuses_assetsReleased, 0) = 0
      ))
      AND otherShift.projectShifts_id <> shift.projectShifts_id
      AND otherShift.projectShifts_start < shift.projectShifts_end AND otherShift.projectShifts_end > shift.projectShifts_start
)
SQL
            : '0';
        return $this->db->rawQuery("
            SELECT shift.projectShifts_id AS shiftId, assignment.users_userid AS memberId, assignment.projectShiftAssignments_role AS role,
                   TRIM(CONCAT(users.users_name1, ' ', users.users_name2)) AS memberName, $conflict AS overlap
            FROM projectShifts AS shift
            JOIN projectShiftAssignments AS assignment ON assignment.projectShifts_id = shift.projectShifts_id AND assignment.projectShiftAssignments_deleted = 0
            LEFT JOIN users ON users.users_userid = assignment.users_userid AND users.users_deleted = 0
            WHERE shift.instances_id = ? AND shift.projects_id = ? AND shift.projectShifts_deleted = 0
            ORDER BY shift.projectShifts_id, memberName, assignment.users_userid
        ", [$this->instance, $project]);
    }

    private function scope(int $project): void
    {
        $this->db->where('instances_id', $this->instance);
        $this->db->where('projects_id', $project);
    }

    private function saveAssignments(int $shift, array $assignments): void
    {
        $this->db->where('projectShifts_id', $shift);
        $this->db->where('projectShiftAssignments_deleted', 0);
        $previous = array_column($this->db->get('projectShiftAssignments'), 'projectShiftAssignments_role', 'users_userid');
        $newIds = array_keys(array_diff_key($assignments, $previous));
        if ($newIds && count($newIds) !== count($this->members($newIds))) {
            throw new InvalidArgumentException('Neue Zuordnungen sind nur für aktive Mitglieder dieser Instanz möglich.');
        }

        $removed = array_keys(array_diff_key($previous, $assignments));
        if ($removed) {
            $this->db->where('projectShifts_id', $shift);
            $this->db->where('users_userid', $removed, 'IN');
            if (!$this->db->update('projectShiftAssignments', ['projectShiftAssignments_deleted' => 1])) {
                throw new RuntimeException('Assignment removal failed.');
            }
        }
        foreach (array_diff_assoc($assignments, $previous) as $user => $role) {
            $this->db->onDuplicate(['projectShiftAssignments_role', 'projectShiftAssignments_deleted']);
            if ($this->db->insert('projectShiftAssignments', [
                'projectShifts_id' => $shift, 'users_userid' => $user,
                'projectShiftAssignments_role' => $role, 'projectShiftAssignments_deleted' => 0,
            ]) === false) {
                throw new RuntimeException('Assignment save failed.');
            }
        }
    }

    public function mutate(int $project, string $action, array $input, callable $audit): int
    {
        $id = isset($input['id']) ? self::id($input['id']) : null;
        if ($action === 'delete' && $id === null) throw new InvalidArgumentException('Schicht fehlt.');
        $revision = $id === null ? 0 : self::id($input['revision'] ?? null);
        $key = $input['requestKey'] ?? null;
        if ($id === null && (!is_string($key) || !preg_match('/^[a-f0-9]{32}$/D', $key))) {
            throw new InvalidArgumentException('Ungültiger Speicherschlüssel.');
        }

        $this->db->startTransaction();
        try {
            if ($this->project($project, true)['projects_archived']) {
                throw new DomainException('Archivierte Projekte können nicht bearbeitet werden.');
            }
            $this->scope($project);
            if ($id === null) {
                $this->db->where('projectShifts_requestKey', $key);
                $existing = $this->db->getValue('projectShifts', 'projectShifts_id');
                if ($existing) {
                    $this->db->commit();
                    return (int)$existing;
                }
            } else {
                $this->db->where('projectShifts_id', $id);
                $this->db->where('projectShifts_deleted', 0);
                $current = $this->db->getValue('projectShifts', 'projectShifts_revision');
                if ($current === null) throw new OutOfBoundsException('Schicht nicht gefunden.');
                if ((int)$current !== $revision) throw new DomainException('Diese Schicht wurde inzwischen geändert. Lade die aktuelle Fassung vor dem Speichern neu.');
            }

            if ($action === 'delete') {
                $values = ['projectShifts_deleted' => 1];
            } else {
                $values = [
                    'projectShifts_start' => self::date($input['start'] ?? null),
                    'projectShifts_end' => self::date($input['end'] ?? null),
                    'projectShifts_title' => self::text($input['title'] ?? '', 180, true),
                    'projectShifts_tasks' => self::text($input['tasks'] ?? '', 4000),
                    'projectShifts_meetingPoint' => self::text($input['meetingPoint'] ?? '', 255),
                    'projectShifts_notes' => self::text($input['notes'] ?? '', 4000),
                ];
                if ($values['projectShifts_end'] <= $values['projectShifts_start']) {
                    throw new InvalidArgumentException('Das Ende muss nach dem Beginn liegen.');
                }
            }

            if ($id === null) {
                $id = $this->db->insert('projectShifts', $values + [
                    'projects_id' => $project, 'instances_id' => $this->instance, 'projectShifts_requestKey' => $key,
                ]);
                if ($id === false) throw new RuntimeException('Shift creation failed.');
            } else {
                $this->scope($project);
                $this->db->where('projectShifts_id', $id);
                if (!$this->db->update('projectShifts', $values + ['projectShifts_revision' => $revision + 1])) {
                    throw new RuntimeException('Shift update failed.');
                }
            }

            if ($action === 'save') {
                $assignments = $input['assignments'] ?? null;
                if (!is_array($assignments) || !array_is_list($assignments)) throw new InvalidArgumentException('Ungültige Besetzung.');
                $roles = [];
                foreach ($assignments as $assignment) {
                    if (!is_array($assignment)) throw new InvalidArgumentException('Ungültige Zuordnung.');
                    $user = self::id($assignment['id'] ?? null);
                    if (isset($roles[$user])) throw new InvalidArgumentException('Eine Person kann pro Schicht einmal zugeordnet werden.');
                    $roles[$user] = self::text($assignment['role'] ?? '', 255);
                }
                $this->saveAssignments((int)$id, $roles);
            } else {
                $this->saveAssignments((int)$id, []);
            }
            $audit((int)$id);
            if (!$this->db->commit()) throw new RuntimeException('Shift transaction failed.');
            return (int)$id;
        } catch (Throwable $error) {
            $this->db->rollback();
            throw $error;
        }
    }
}
