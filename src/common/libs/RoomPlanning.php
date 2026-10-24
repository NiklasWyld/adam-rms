<?php
declare(strict_types=1);

final class RoomPlanning
{
    public const STATUSES = ['planned' => 'Planned', 'requested' => 'Requested', 'confirmed' => 'Confirmed', 'rejected' => 'Rejected', 'cancelled' => 'Cancelled'];
    private const ACTIVE = ['planned', 'requested', 'confirmed'];
    private DateTimeZone $zone;
    public function __construct(private $db, private int $instance, private int $user)
    {
        $db->where('instances_id', $instance);
        $this->zone = new DateTimeZone($db->getValue('instances', 'instances_config_roomPlanningTimezone') ?: 'Europe/Berlin');
    }
    public static function id($value): int
    {
        if ((!is_int($value) && !is_string($value)) || !preg_match('/^[1-9][0-9]{0,9}$/D', (string)$value) || (int)$value > 2147483647) throw new InvalidArgumentException('Invalid record ID.');
        return (int)$value;
    }
    private static function text(array $data, string $key, int $max, bool $required = false): string
    {
        $value = $data[$key] ?? '';
        if (!is_string($value) || !mb_check_encoding($value, 'UTF-8') || mb_strlen($value) > $max ||
            preg_match('/[\x00-\x08\x0B\x0C\x0E-\x1F]/', $value) || ($required && trim($value) === '')) {
            throw new InvalidArgumentException('Enter valid ' . $key . ' (maximum ' . $max . ' characters).');
        }
        return trim($value);
    }
    private function scope(string $table): void
    {
        $this->db->where($table . '.instances_id', $this->instance);
        $this->db->where($table . '.' . $table . '_deleted', 0);
    }
    public function project(int $id, bool $lock = false): array
    {
        $this->scope('projects'); $this->db->where('projects_id', $id);
        if ($lock) $this->db->setQueryOption('FOR UPDATE');
        $p = $this->db->getOne('projects', ['projects_id', 'projects_name', 'projects_archived', 'projects_dates_use_start', 'projects_dates_use_end', 'projects_dates_deliver_start', 'projects_dates_deliver_end']);
        if (!$p) throw new OutOfBoundsException('Project not found.');
        return $p;
    }
    public function room(int $id, bool $lock = false): array
    {
        $this->scope('rooms'); $this->db->where('rooms_id', $id);
        if ($lock) $this->db->setQueryOption('FOR UPDATE');
        $r = $this->db->getOne('rooms');
        if (!$r) throw new OutOfBoundsException('Room not found.');
        return $r;
    }
    private function booking(int $project, int $id, bool $lock = false): array
    {
        $this->scope('roomReservations'); $this->db->where('projects_id', $project); $this->db->where('roomReservations_id', $id);
        if ($lock) $this->db->setQueryOption('FOR UPDATE');
        $r = $this->db->getOne('roomReservations');
        if (!$r) throw new OutOfBoundsException('Room booking not found.');
        return $r;
    }
    private function date(string $value): DateTimeImmutable
    {
        $date = DateTimeImmutable::createFromFormat('!Y-m-d\TH:i', $value, $this->zone);
        if (!$date || $date->format('Y-m-d\TH:i') !== $value || $date->format('Y') < '2000' || $date->format('Y') > '2200') {
            throw new InvalidArgumentException('Enter a valid date and time between 2000 and 2200 in ' . $this->zone->getName() . '.');
        }
        return $date;
    }
    private function interval(array $data): array
    {
        $start = $this->date(self::text($data, 'start', 16, true)); $end = $this->date(self::text($data, 'end', 16, true));
        if ($end <= $start) throw new InvalidArgumentException('The end must be after the start.');
        return [$start->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s'), $end->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s')];
    }
    private function local(string $value, string $format): string
    {
        return (new DateTimeImmutable($value, new DateTimeZone('UTC')))->setTimezone($this->zone)->format($format);
    }
    public function metadata(bool $locations = false): array
    {
        $this->scope('rooms');
        $this->db->join('locations', 'locations.locations_id=rooms.locations_id AND locations.instances_id=rooms.instances_id AND locations.locations_deleted=0', 'LEFT');
        $this->db->orderBy('rooms_name', 'ASC'); $this->db->orderBy('rooms_id', 'ASC');
        $rooms = $this->db->get('rooms', null, ['rooms.*', 'locations.locations_name AS locationName']) ?: [];
        foreach ($rooms as &$r) $r['building'] = $r['rooms_building'] ?: ($r['locationName'] ?? '');
        $result = ['rooms' => $rooms, 'statuses' => self::STATUSES, 'timeZone' => $this->zone->getName(), 'locations' => []];
        if ($locations) {
            $this->scope('locations'); $this->db->orderBy('locations_name', 'ASC');
            $result['locations'] = $this->db->get('locations', null, ['locations_id', 'locations_name', 'locations_archived']) ?: [];
            $result['timeZones'] = DateTimeZone::listIdentifiers();
        }
        return $result;
    }
    private function rows(?int $project, ?string $from = null, ?string $to = null, ?array $roomIds = null): array
    {
        $this->scope('roomReservations');
        $this->db->where('projects.instances_id', $this->instance); $this->db->where('projects.projects_deleted', 0);
        $this->db->where('rooms.instances_id', $this->instance); $this->db->where('rooms.rooms_deleted', 0);
        $this->db->join('projects', 'projects.projects_id=roomReservations.projects_id', 'INNER');
        $this->db->join('rooms', 'rooms.rooms_id=roomReservations.rooms_id', 'INNER');
        $this->db->join('locations', 'locations.locations_id=rooms.locations_id AND locations.instances_id=rooms.instances_id AND locations.locations_deleted=0', 'LEFT');
        if ($project !== null) $this->db->where('roomReservations.projects_id', $project);
        if ($from !== null) $this->db->where('roomReservations_end', $from, '>');
        if ($to !== null) $this->db->where('roomReservations_start', $to, '<');
        if ($roomIds !== null) {
            $this->db->where('roomReservations.rooms_id', $roomIds, 'IN');
            $this->db->where('roomReservations_status', self::ACTIVE, 'IN');
        }
        $this->db->orderBy('roomReservations_start', 'ASC'); $this->db->orderBy('roomReservations_id', 'ASC');
        return $this->db->get('roomReservations', null, ['roomReservations.*', 'rooms.rooms_name', 'rooms.rooms_number', 'rooms.rooms_building', 'rooms.rooms_active', 'locations.locations_name AS locationName', 'projects.projects_name', 'projects.projects_archived']) ?: [];
    }
    private function describe(array $r): array
    {
        $r['start'] = $this->local($r['roomReservations_start'], 'Y-m-d\TH:i');
        $r['end'] = $this->local($r['roomReservations_end'], 'Y-m-d\TH:i');
        $r['startUtc'] = str_replace(' ', 'T', $r['roomReservations_start']) . 'Z';
        $r['endUtc'] = str_replace(' ', 'T', $r['roomReservations_end']) . 'Z';
        $r['period'] = $this->local($r['roomReservations_start'], 'd.m.Y H:i') . ' - ' . $this->local($r['roomReservations_end'], 'd.m.Y H:i');
        $r['building'] = $r['rooms_building'] ?: ($r['locationName'] ?? '');
        return $r;
    }
    private function overlaps(array $bookings): array
    {
        $active = array_values(array_filter($bookings, fn($b) => in_array($b['roomReservations_status'], self::ACTIVE, true)));
        if (!$active) return [];
        $ids = array_values(array_unique(array_column($active, 'rooms_id')));
        $candidates = $this->rows(null, min(array_column($active, 'roomReservations_start')), max(array_column($active, 'roomReservations_end')), $ids);
        $byRoom = []; foreach ($candidates as $c) $byRoom[$c['rooms_id']][] = $c;
        $result = [];
        foreach ($active as $b) foreach ($byRoom[$b['rooms_id']] ?? [] as $c) {
            if ($c['roomReservations_start'] >= $b['roomReservations_end']) break;
            if ($c['roomReservations_id'] == $b['roomReservations_id'] || $c['roomReservations_end'] <= $b['roomReservations_start']) continue;
            $item = $this->describe($c);
            $item['severity'] = ($c['roomReservations_status'] === 'confirmed' || $b['roomReservations_status'] === 'confirmed') ? 'confirmed' : 'potential';
            $result[$b['roomReservations_id']][] = $item;
        }
        return $result;
    }
    /** Validate before a catalogue mutation so a bad overview range cannot report a committed save as failed. */
    public function overviewRange(?string $from, ?string $to): array
    {
        $from = $from ?: (new DateTimeImmutable('first day of this month', $this->zone))->format('Y-m-d');
        $to = $to ?: (new DateTimeImmutable('first day of next month', $this->zone))->format('Y-m-d');
        $a = $this->date($from . 'T00:00'); $b = $this->date($to . 'T00:00');
        if ($b <= $a || $a->diff($b)->days > 93) throw new InvalidArgumentException('Choose an overview period of up to 93 days.');
        return [$a->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s'), $b->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s')];
    }
    public function document(?int $project, bool $includeBookings, bool $manageRooms, ?string $from = null, ?string $to = null): array
    {
        $p = $project !== null ? $this->project($project) : null;
        $meta = $this->metadata($manageRooms);
        $meta['project'] = $p; $meta['bookings'] = []; $meta['summary'] = ['rooms' => 0, 'confirmed' => 0, 'open' => 0, 'requested' => 0, 'conflicts' => 0];
        if (!$includeBookings) return $meta;
        if ($project === null) {
            [$from, $to] = $this->overviewRange($from, $to);
        }
        $bookings = $this->rows($project, $from, $to); $conflicts = $this->overlaps($bookings); $pairs = []; $rooms = [];
        foreach ($bookings as $b) {
            $b = $this->describe($b); $b['conflicts'] = $conflicts[$b['roomReservations_id']] ?? [];
            foreach ($b['conflicts'] as $c) {
                $pair = [$b['roomReservations_id'], $c['roomReservations_id']]; sort($pair); $pairs[implode(':', $pair)] = true;
            }
            if (in_array($b['roomReservations_status'], self::ACTIVE, true)) $rooms[$b['rooms_id']] = true;
            if ($b['roomReservations_status'] === 'confirmed') $meta['summary']['confirmed']++;
            if (in_array($b['roomReservations_status'], ['planned', 'requested'], true)) $meta['summary']['open']++;
            if ($b['roomReservations_status'] === 'requested') $meta['summary']['requested']++;
            $meta['bookings'][] = $b;
        }
        $meta['summary']['rooms'] = count($rooms); $meta['summary']['conflicts'] = count($pairs);
        $meta['request'] = $p ? $this->request($p, $meta['bookings']) : null;
        return $meta;
    }
    public function request(array $project, array $bookings): array
    {
        $pending = array_values(array_filter($bookings, fn($b) => in_array($b['roomReservations_status'], ['planned', 'requested'], true)));
        $event = $project['projects_dates_use_start'] ?: $project['projects_dates_deliver_start'];
        $eventEnd = $project['projects_dates_use_end'] ?: $project['projects_dates_deliver_end'];
        $eventDates = $event ? substr($event, 0, 10) . ($eventEnd && substr($eventEnd, 0, 10) !== substr($event, 0, 10) ? ' - ' . substr($eventEnd, 0, 10) : '') : '';
        $subject = 'Raumanfrage - ' . $project['projects_name'];
        $lines = ['Guten Tag,', '', 'für die Veranstaltung "' . $project['projects_name'] . '" werden folgende Räume benötigt:'];
        if ($eventDates) $lines[] = 'Veranstaltungsdatum: ' . $eventDates;
        $lines[] = 'Zeitzone: ' . $this->zone->getName(); $lines[] = '';
        foreach ($pending as $b) {
            $lines[] = '- ' . $b['rooms_name'] . ($b['rooms_number'] ? ' (Raum ' . $b['rooms_number'] . ')' : '') . ': ' . $b['period'] . ' - ' . $b['roomReservations_purpose'];
            if ($b['building']) $lines[] = '  Standort: ' . $b['building'];
            if ($b['roomReservations_notes']) $lines[] = '  Bemerkungen: ' . $b['roomReservations_notes'];
        }
        if (!$pending) $lines[] = 'Es liegen keine offenen Raumanfragen vor.';
        $lines[] = ''; $lines[] = 'Bitte teilen Sie uns mit, ob die Räume für diese Zeiträume reserviert werden können.';
        $lines[] = ''; $lines[] = 'Vielen Dank!';
        return ['subject' => $subject, 'body' => implode("\n", $lines), 'bookings' => $pending, 'eventDates' => $eventDates];
    }
    private function revision(array $data, array $old, string $column): void
    {
        $value = $data['revision'] ?? null;
        if ((!is_int($value) && !is_string($value)) || !preg_match('/^[0-9]{1,10}$/D', (string)$value) || (int)$value !== (int)$old[$column]) {
            throw new DomainException('This record changed in another tab. Reload the current data before saving your edits.');
        }
    }
    public function check(int $project, array $data): array
    {
        $this->project($project); $room = self::id($data['roomId'] ?? null); $this->room($room);
        $id = empty($data['id']) ? 0 : self::id($data['id']); if ($id) $this->booking($project, $id);
        [$start, $end] = $this->interval($data);
        $status = self::text($data, 'status', 16, true); if (!isset(self::STATUSES[$status])) throw new InvalidArgumentException('Invalid booking status.');
        return $this->overlaps([['roomReservations_id' => $id, 'rooms_id' => $room, 'roomReservations_start' => $start, 'roomReservations_end' => $end, 'roomReservations_status' => $status]])[$id] ?? [];
    }
    public function mutate(string $action, array $data, callable $audit): int
    {
        $this->db->startTransaction();
        try {
            $now = gmdate('Y-m-d H:i:s');
            if ($action === 'timezone') {
                $zone = self::text($data, 'timeZone', 64, true);
                if (!in_array($zone, DateTimeZone::listIdentifiers(), true)) throw new InvalidArgumentException('Choose a valid time zone.');
                $this->db->where('instances_id', $this->instance);
                $ok = $this->db->update('instances', ['instances_config_roomPlanningTimezone' => $zone]); $id = $this->instance;
            } elseif ($action === 'saveRoom') {
                $id = empty($data['id']) ? 0 : self::id($data['id']);
                if ($id) { $old = $this->room($id, true); $this->revision($data, $old, 'rooms_revision'); }
                $location = empty($data['locationId']) ? null : self::id($data['locationId']);
                if ($location !== null) {
                    $this->scope('locations'); $this->db->where('locations_id', $location);
                    if (!$this->db->getOne('locations', ['locations_id'])) throw new OutOfBoundsException('Location not found.');
                }
                $capacity = ($data['capacity'] ?? '') === '' ? null : self::id($data['capacity']);
                if ($capacity !== null && $capacity > 1000000) throw new InvalidArgumentException('Capacity must be between 1 and 1,000,000.');
                if (!in_array($data['active'] ?? '', ['0', '1', 0, 1], true)) throw new InvalidArgumentException('Invalid room availability.');
                $record = ['locations_id' => $location, 'rooms_name' => self::text($data, 'name', 255, true), 'rooms_number' => self::text($data, 'number', 64),
                    'rooms_building' => self::text($data, 'building', 255), 'rooms_capacity' => $capacity,
                    'rooms_description' => self::text($data, 'description', 4000), 'rooms_equipment' => self::text($data, 'equipment', 4000),
                    'rooms_notes' => self::text($data, 'notes', 8000), 'rooms_active' => (int)$data['active'],
                    'rooms_updated' => $now, 'rooms_updatedBy' => $this->user, 'rooms_revision' => $id ? (int)$old['rooms_revision'] + 1 : 1];
                if ($id) { $this->scope('rooms'); $this->db->where('rooms_id', $id); $ok = $this->db->update('rooms', $record); }
                else { $id = $this->db->insert('rooms', $record + ['instances_id' => $this->instance, 'users_userid' => $this->user, 'rooms_created' => $now]); $ok = $id; }
            } else {
                $project = self::id($data['projects_id'] ?? null); $p = $this->project($project, true);
                if ($p['projects_archived']) throw new InvalidArgumentException('Archived projects are read-only.');
                $id = empty($data['id']) ? 0 : self::id($data['id']);
                if ($action !== 'saveBooking' && !$id) throw new InvalidArgumentException('A booking ID is required.');
                if ($id) { $old = $this->booking($project, $id, true); $this->revision($data, $old, 'roomReservations_revision'); }
                $record = ['roomReservations_updated' => $now, 'roomReservations_updatedBy' => $this->user, 'roomReservations_revision' => $id ? (int)$old['roomReservations_revision'] + 1 : 1];
                if ($action === 'deleteBooking') $record['roomReservations_deleted'] = 1;
                else {
                    $status = self::text($data, 'status', 16, true);
                    if (!isset(self::STATUSES[$status])) throw new InvalidArgumentException('Choose a valid booking status.');
                    $record['roomReservations_status'] = $status;
                    if ($action === 'saveBooking') {
                        $room = self::id($data['roomId'] ?? null); $r = $this->room($room, true);
                        if (!$r['rooms_active'] && (!$id || $old['rooms_id'] != $room)) throw new InvalidArgumentException('Choose an active room for a new booking.');
                        [$start, $end] = $this->interval($data);
                        $record += ['rooms_id' => $room, 'roomReservations_start' => $start, 'roomReservations_end' => $end,
                            'roomReservations_purpose' => self::text($data, 'purpose', 1000, true), 'roomReservations_notes' => self::text($data, 'notes', 8000)];
                    }
                }
                if ($id) { $this->scope('roomReservations'); $this->db->where('roomReservations_id', $id); $this->db->where('projects_id', $project); $ok = $this->db->update('roomReservations', $record); }
                else { $id = $this->db->insert('roomReservations', $record + ['instances_id' => $this->instance, 'projects_id' => $project, 'users_userid' => $this->user, 'roomReservations_created' => $now]); $ok = $id; }
            }
            if (!$ok) throw new RuntimeException('Unable to save room planning.');
            $audit((int)$id);
            if (!$this->db->commit()) throw new RuntimeException('Unable to commit room planning.');
            return (int)$id;
        } catch (Throwable $error) { $this->db->rollback(); throw $error; }
    }
}
