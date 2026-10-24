<?php
declare(strict_types=1);

/** One canonical document per project; no files or external service contain the saved plan. */
final class ChannelPlanning
{
    public function __construct(private $db, private int $instance) {}

    public static function integer($value, int $min, int $max): int
    {
        if (!is_scalar($value) || !preg_match('/^[0-9]{1,10}$/D', (string)$value) || (int)$value < $min || (int)$value > $max) {
            throw new InvalidArgumentException('Invalid channel count, revision or project ID.');
        }
        return (int)$value;
    }

    public function project(int $id, bool $lock = false): array
    {
        $this->db->where('projects_id', $id);
        $this->db->where('instances_id', $this->instance);
        $this->db->where('projects_deleted', 0);
        if ($lock) $this->db->setQueryOption('FOR UPDATE');
        $project = $this->db->getOne('projects', ['projects_id', 'projects_name', 'projects_archived']);
        if (!$project) throw new OutOfBoundsException('Project not found.');
        return $project;
    }

    public function document(int $id): array
    {
        $this->project($id);
        $this->db->where('projects_id', $id);
        $this->db->where('instances_id', $this->instance);
        $this->db->where('projectChannelPlans_deleted', 0);
        $row = $this->db->getOne('projectChannelPlans');
        if (!$row) return ['configured' => false, 'inputCount' => 32, 'outputCount' => 10, 'outputLabels' => 'alphabetic',
            'inputs' => [], 'outputs' => [], 'revision' => 0, 'updated' => null];
        $data = json_decode($row['projectChannelPlans_data'], true, 64, JSON_THROW_ON_ERROR);
        return ['configured' => true, 'inputCount' => (int)$row['projectChannelPlans_inputs'],
            'outputCount' => (int)$row['projectChannelPlans_outputs'], 'outputLabels' => $row['projectChannelPlans_outputLabels'],
            'inputs' => $data['inputs'], 'outputs' => $data['outputs'],
            'revision' => (int)$row['projectChannelPlans_revision'], 'updated' => $row['projectChannelPlans_updated']];
    }

    private static function text($value): string
    {
        if (!is_string($value) || !mb_check_encoding($value, 'UTF-8') || mb_strlen($value) > 4000 ||
            preg_match('/[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F]/', $value)) {
            throw new InvalidArgumentException('Each field must be valid text with at most 4,000 characters.');
        }
        return trim($value);
    }

    private static function channels($rows, int $count): array
    {
        if (!is_array($rows) || !array_is_list($rows) || count($rows) !== $count) {
            throw new InvalidArgumentException('The channel rows must match the configured count.');
        }
        $clean = [];
        foreach ($rows as $row) {
            if (!is_array($row) || !array_is_list($row) || count($row) < 1 || count($row) > 20) {
                throw new InvalidArgumentException('Each channel needs between 1 and 20 uses.');
            }
            $uses = [];
            foreach ($row as $use) {
                if (!is_array($use)) throw new InvalidArgumentException('Invalid channel use.');
                $entry = [];
                foreach (['scene', 'label', 'connection', 'notes'] as $field) $entry[$field] = self::text($use[$field] ?? '');
                $uses[] = $entry;
            }
            $clean[] = $uses;
        }
        return $clean;
    }

    public static function populated(array $rows): bool
    {
        foreach ($rows as $row) foreach ($row as $entry) foreach ($entry as $value) if (trim((string)$value) !== '') return true;
        return false;
    }

    public function save(int $id, array $payload, bool $confirmed, callable $audit): array
    {
        $inputs = self::integer($payload['inputCount'] ?? null, 0, 512);
        $outputs = self::integer($payload['outputCount'] ?? null, 0, 256);
        $revision = self::integer($payload['revision'] ?? null, 0, 2147483646);
        $labels = $payload['outputLabels'] ?? '';
        if (!is_string($labels) || !in_array($labels, ['alphabetic', 'numeric'], true)) throw new InvalidArgumentException('Invalid output numbering.');
        $data = ['inputs' => self::channels($payload['inputs'] ?? null, $inputs), 'outputs' => self::channels($payload['outputs'] ?? null, $outputs)];
        $encoded = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        if (strlen($encoded) > 2000000) throw new InvalidArgumentException('This plan exceeds the 2 MB limit.');
        $this->db->startTransaction();
        try {
            // Lock the project even before a plan exists, serialising simultaneous first saves.
            $project = $this->project($id, true);
            if ($project['projects_archived']) throw new InvalidArgumentException('Archived projects are read-only.');
            $current = $this->document($id);
            if ($revision !== $current['revision']) throw new DomainException('This plan changed in another tab. Your edits have been kept on screen. Reload the saved plan before editing again.');
            $removed = self::populated(array_slice($current['inputs'], $inputs)) || self::populated(array_slice($current['outputs'], $outputs));
            if ($removed && !$confirmed) throw new LengthException('Reducing these counts removes populated channels. Confirm the reduction first.');
            $record = ['projectChannelPlans_inputs' => $inputs, 'projectChannelPlans_outputs' => $outputs,
                'projectChannelPlans_outputLabels' => $labels, 'projectChannelPlans_data' => $encoded,
                'projectChannelPlans_revision' => $revision + 1, 'projectChannelPlans_updated' => date('Y-m-d H:i:s')];
            if (!$current['configured']) {
                $saved = $this->db->insert('projectChannelPlans', $record + ['projects_id' => $id, 'instances_id' => $this->instance]);
            } else {
                $this->db->where('projects_id', $id);
                $this->db->where('instances_id', $this->instance);
                $this->db->where('projectChannelPlans_deleted', 0);
                $this->db->where('projectChannelPlans_revision', $revision);
                $saved = $this->db->update('projectChannelPlans', $record);
            }
            if (!$saved) throw new RuntimeException('Unable to save channel plan.');
            $audit();
            if (!$this->db->commit()) throw new RuntimeException('Unable to commit channel plan.');
            return $this->document($id);
        } catch (Throwable $error) {
            $this->db->rollback();
            throw $error;
        }
    }
}
