<?php
declare(strict_types=1);
// Contract test with real isolated MySQL persistence, entirely in-memory TickTick transport.
if (getenv('DB_DATABASE') !== 'adamrms_e2e') throw new RuntimeException('Only the disposable adamrms_e2e database is allowed.');
require __DIR__ . '/../../vendor/autoload.php';
require __DIR__ . '/../../src/common/libs/TaskPlanning.php';
require __DIR__ . '/../../src/common/libs/TaskTickTick.php';
function check(bool $ok, string $message): void { if (!$ok) throw new RuntimeException($message); }
$db = new MysqliDb(['host'=>getenv('DB_HOSTNAME'),'username'=>getenv('DB_USERNAME'),'password'=>getenv('DB_PASSWORD'),'db'=>getenv('DB_DATABASE'),'port'=>getenv('DB_PORT') ?: 3306,'charset'=>'utf8mb4']);
$instance=(int)$argv[1];$user=(int)$argv[2];$source=(int)$argv[3];
$db->where('projects_id',$source);$p=$db->getOne('projects');unset($p['projects_id']);
$p['projects_name']='TickTick contract '.bin2hex(random_bytes(6));$p['projects_archived']=0;$p['projects_deleted']=0;
$project=(int)$db->insert('projects',$p);check($project>0,'Project fixture');
putenv('TASK_PLANNING_TOKEN_KEY='.base64_encode(random_bytes(32)));
putenv('TICKTICK_CLIENT_ID=contract-client');putenv('TICKTICK_CLIENT_SECRET=contract-secret');
putenv('TICKTICK_REDIRECT_URI=https://example.invalid/taskPlanning/callback.php');
$service=new TaskPlanning($db,$instance,$user);$lists=[];$remote=[];$creates=0;$updates=0;$completes=0;$lose=false;$loseWithoutCreate=false;
$transport=function($method,$url,$body)use(&$lists,&$remote,&$creates,&$updates,&$completes,&$lose,&$loseWithoutCreate):array{
    $path=parse_url($url,PHP_URL_PATH);
    if($path==='/oauth/token')return ['access_token'=>'contract-token-never-log','expires_in'=>3600];
    if($path==='/open/v1/project' && $method==='GET')return array_values($lists);
    if($path==='/open/v1/project' && $method==='POST'){$id=bin2hex(random_bytes(12));return $lists[$id]=['id'=>$id]+$body;}
    if(preg_match('~/open/v1/project/([^/]+)/data~',$path))return ['tasks'=>array_values(array_filter($remote,fn($r)=>$r['projectId']===explode('/',$path)[4])),'project'=>reset($lists)];
    if(preg_match('~/open/v1/project/([^/]+)/task/([^/]+)$~',$path,$m)) {
        if(isset($remote[$m[2]]) && $remote[$m[2]]['projectId']===$m[1])return $remote[$m[2]];
        throw new TaskTickTickHttpError(404,'Missing task in target list');
    }
    if($path==='/open/v1/task/move') {
        foreach($body as $move){check(isset($remote[$move['taskId']]),'Move retains ID');$remote[$move['taskId']]['projectId']=$move['toProjectId'];}
        return [];
    }
    if($path==='/open/v1/task' && $method==='POST'){
        if($loseWithoutCreate){$loseWithoutCreate=false;throw new RuntimeException('simulated uncertain pre-create failure');}
        $id=bin2hex(random_bytes(12));$creates++;$remote[$id]=['id'=>$id,'status'=>0]+$body;
        if($lose){$lose=false;throw new RuntimeException('simulated lost create response');}
        return $remote[$id];
    }
    if(preg_match('~/open/v1/task/([^/]+)$~',$path,$m)){$updates++;check(isset($remote[$m[1]]),'Must update a known task ID');return $remote[$m[1]]=array_replace($remote[$m[1]],$body);}
    if(preg_match('~/task/([^/]+)/complete$~',$path,$m)){$completes++;$remote[$m[1]]['status']=2;return [];}
    throw new RuntimeException('Unexpected contract endpoint '.$path);
};
$tick=new TaskTickTick($db,$service,$transport);$_SESSION=[];
try{
    $url=$tick->authorise($project);parse_str(parse_url($url,PHP_URL_QUERY),$q);check($q['scope']==='tasks:read tasks:write','OAuth scopes');
    check($tick->callback($q['state'],'contract-code')===$project,'OAuth callback');
    $db->where('instances_id',$instance);$db->where('users_userid',$user);$stored=$db->getValue('taskTickConnections','taskTickConnections_token');
    check(!str_contains($stored,'contract-token'),'Encrypted persistence');check($tick->status($project)['connected'],'Connected metadata');
    $url=$tick->authorise($project);parse_str(parse_url($url,PHP_URL_QUERY),$q);
    try{$tick->callback('wrong','contract-code');throw new RuntimeException('Bad state accepted');}catch(DomainException $e){}
    $ids=$service->mutate('create',$project,['items'=>[['title'=>'Contract PA','category'=>'Ton','priority'=>3,'day'=>'2027-07-12','time'=>'08:30','deadline'=>'2027-07-11T18:00','assignee'=>$user,'checklist'=>[['id'=>'mic','title'=>'Mic','done'=>true]]]]],bin2hex(random_bytes(16)),fn()=>null);
    $tick->sync($project,true);check($creates===1,'Initial create');
    $firstId=array_key_first($remote);check($remote[$firstId]['priority']===5,'Urgent priority');
    check($remote[$firstId]['startDate']==='2027-07-12T08:30:00+0200','Business timezone');
    check($remote[$firstId]['dueDate']==='2027-07-12T08:30:00+0200' && str_contains($remote[$firstId]['content'],'2027-07-11T18:00'),'Independent deadline retained without invalid interval');
    check($remote[$firstId]['items'][0]['status']===1,'Checklist state');
    $tick->sync($project,true);check($creates===1,'Repeat creates no duplicates');
    $t=$service->tasks($project)[0];
    $service->mutate('update',$project,['items'=>[['id'=>$t['id'],'revision'=>$t['revision'],'patch'=>['title'=>'Updated PA','status'=>'done']]]],bin2hex(random_bytes(16)),fn()=>null);
    $tick->sync($project,true);check($creates===1 && $updates>0 && $completes===1,'Update/complete');
    check($remote[$firstId]['title']==='Updated PA','Known ID updated');
    $t=$service->tasks($project)[0];
    $service->mutate('update',$project,['items'=>[['id'=>$t['id'],'revision'=>$t['revision'],'patch'=>['status'=>'open','day'=>'','deadline'=>'']]]],bin2hex(random_bytes(16)),fn()=>null);
    $tick->sync($project,true);check($remote[$firstId]['status']===0 && $remote[$firstId]['startDate']===null,'Reopen and clear dates');
    $db->where('projects_id',$project);$otherProject=$db->getOne('projects');unset($otherProject['projects_id']);$otherProject['projects_name'].=' moved';
    $target=(int)$db->insert('projects',$otherProject);
    $t=$service->tasks($project)[0];
    $service->mutate('update',$project,['items'=>[['id'=>$t['id'],'revision'=>$t['revision'],'patch'=>['project'=>$target]]]],bin2hex(random_bytes(16)),fn()=>null);
    $tick->sync($target,true);check($creates===1 && count($remote)===1,'Project move creates no duplicate');
    $t=$service->tasks($target)[0];
    $service->mutate('update',$target,['items'=>[['id'=>$t['id'],'revision'=>$t['revision'],'patch'=>['project'=>$project]]]],bin2hex(random_bytes(16)),fn()=>null);
    $tick->sync($project,true);
    $db->where('projects_id',$target);$db->update('projects',['projects_deleted'=>1]);
    $service->mutate('create',$project,['items'=>[['title'=>'Lost response','assignee'=>$user]]],bin2hex(random_bytes(16)),fn()=>null);
    $lose=true;try{$tick->sync($project,true);throw new RuntimeException('Expected lost response');}catch(DomainException $e){}
    $before=$creates;$tick->sync($project,true);check($creates===$before && count($remote)===2,'Reconciled without duplicate');
    $service->mutate('create',$project,['items'=>[['title'=>'Uncertain failure','assignee'=>$user]]],bin2hex(random_bytes(16)),fn()=>null);
    $loseWithoutCreate=true;try{$tick->sync($project,true);throw new RuntimeException('Expected uncertain failure');}catch(DomainException $e){}
    $before=$creates;try{$tick->sync($project,true);throw new RuntimeException('Unsafe retry');}catch(DomainException $e){check(str_contains($e->getMessage(),'uncertain'),'Explains uncertainty');}
    check($before===$creates,'Never blindly retries a pending create');
    // Other users and tenants cannot see this connection or its mappings.
    $other=new TaskTickTick($db,new TaskPlanning($db,$instance,$user+100000));
    check(!$other->status(null)['connected'],'Personal connection boundary');
    $tick->disconnect();check(!$tick->status($project)['connected'],'Disconnect');
    echo "PASS TickTick contract: OAuth/state, encrypted persistence, timezone, checklist, update/complete/reopen, reconciliation, no duplicate retry, user isolation\n";
}finally{
    $tick->disconnect();$db->where('projects_id',$project);$db->where('instances_id',$instance);$db->update('projects',['projects_deleted'=>1]);
}
