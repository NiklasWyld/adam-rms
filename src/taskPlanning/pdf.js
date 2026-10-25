/* Uses the same pdfMake infrastructure and embedded fonts as existing RMS exports. */
(function () {
    'use strict';
    const d = JSON.parse(document.getElementById('task-pdf-data').textContent), plan = d.plan, rows = plan.tasks;
    const wrap = v => String(v == null ? '' : v).replace(/(\S{28})(?=\S)/g, '$1\u200b');
    const cell = (text, more) => ({text:wrap(text),fontSize:8,margin:[0,4,0,4],...more});
    const completed = rows.filter(t => t.status === 'done').length;
    const checkbox = done => ({canvas:[{type:'rect',x:1,y:3,w:9,h:9,lineWidth:.7,lineColor:'#718096'},
        ...(done ? [{type:'line',x1:2,y1:7,x2:5,y2:10,lineWidth:1,lineColor:'#275d4d'},{type:'line',x1:5,y1:10,x2:9,y2:4,lineWidth:1,lineColor:'#275d4d'}] : [])]});
    const content = [];
    const title = {stack:[{text:'TASK PLAN',fontSize:9,bold:true,color:'#5f7388',characterSpacing:1.5},{text:wrap(plan.title),fontSize:23,bold:true,margin:[0,5,0,5]},
        {text:wrap(d.business),fontSize:10,color:'#5f7388'}]};
    if (d.logo) content.push({columns:[title,{image:d.logo,fit:[90,55],alignment:'right'}],margin:[0,0,0,18]});
    else content.push({...title,margin:[0,0,0,18]});
    content.push({columns:[{text:completed+' / '+rows.length+' completed',bold:true,fontSize:12},{text:(rows.length ? Math.round(completed/rows.length*100) : 0)+'% complete',alignment:'right',color:'#5f7388'}],margin:[0,0,0,8]});
    content.push({canvas:[{type:'rect',x:0,y:0,w:515,h:5,color:'#e7edf2'},...(completed ? [{type:'rect',x:0,y:0,w:515*completed/rows.length,h:5,color:'#36826d'}] : [])],margin:[0,0,0,12]});
    content.push({text:(plan.filtered ? 'Filtered task selection' : 'All tasks in this view')+' · '+plan.timeZone+' · '+d.exported,fontSize:8,color:'#6e7d8c',margin:[0,0,0,18]});
    if (!rows.length) content.push({text:'No tasks match this selection.',fontSize:11,color:'#6e7d8c',margin:[0,20,0,0]});
    let groups = [];
    for (const t of rows) {
        const group = plan.group ? t[plan.group] || (plan.group === 'day' ? 'Unscheduled' : 'Uncategorised') : 'Tasks';
        if (!groups.length || groups[groups.length-1].name !== group) groups.push({name:group,tasks:[]});
        groups[groups.length-1].tasks.push(t);
    }
    groups.forEach(g => {
        const heading = ['','Task / category','Planned / deadline','Responsible','Priority / status'];
        const body = [heading.map(v => cell(v,{bold:true,color:'#fff',fillColor:'#34495e'}))];
        for (const t of g.tasks) {
            const checklist = plan.includeChecklists ? t.checklist.map(c => ({columns:[{...checkbox(c.done),width:15},{text:wrap(c.title),fontSize:8,color:'#526475'}],columnGap:2,margin:[0,3,0,0]})) : [];
            const desc = t.description ? [{text:wrap(t.description),fontSize:8,color:'#6e7d8c',margin:[0,3,0,0]}] : [];
            body.push([checkbox(t.status === 'done'),{stack:[{text:wrap(t.title),fontSize:9,bold:true,margin:[0,4,0,2]},
                {text:wrap(t.category || 'Uncategorised'),fontSize:8,color:'#6e7d8c'},
                ...(!plan.project ? [{text:wrap(t.projectName),fontSize:8,color:'#526475'}] : []),...desc,...checklist]},
                cell((t.day || 'Unscheduled')+(t.time ? ' '+t.time : '')+(t.deadline ? '\nDue '+t.deadline.replace('T',' ') : '')),
                cell(t.assigneeName || 'Unassigned'),cell(plan.priorities[t.priority]+'\n'+plan.statuses[t.status],t.priority === 3 ? {color:'#9d3030'} : {})]);
        }
        content.push({text:wrap(g.name)+'  ·  '+g.tasks.length,fontSize:12,bold:true,color:'#34495e',margin:[0,10,0,7],headlineLevel:1});
        content.push({table:{headerRows:1,widths:[15,'*',105,78,70],body},layout:{hLineWidth:i => i === 1 ? 0 : .5,vLineWidth:() => 0,hLineColor:() => '#e1e7ed',
            fillColor:i => i > 0 && i%2 === 0 ? '#f7f9fb' : null,paddingLeft:() => 5,paddingRight:() => 5},margin:[0,0,0,8]});
    });
    const definition = {pageSize:'A4',pageMargins:[40,38,40,42],defaultStyle:{font:'Roboto',fontSize:9},content,
        footer:(page,pages) => ({columns:[{text:'AdamRMS · '+wrap(plan.title),color:'#7e8c98'},{text:page+' / '+pages,alignment:'right',color:'#7e8c98'}],fontSize:8,margin:[40,15,40,0]}),
        pageBreakBefore:(node,following) => node.headlineLevel === 1 && following.length === 0,
        info:{title:plan.title+' — Task plan',author:d.business,subject:'Project task planning'}};
    const filename = plan.title.replace(/[\/\\:*?"<>|\x00-\x1f]/g,'_').slice(0,100)+' - Task plan.pdf';
    function failed() { document.getElementById('pdf-error').textContent = 'The PDF could not be generated. Reload this page and try again.'; }
    function create() { if (!window.pdfMake) throw new Error('PDF library unavailable'); return window.pdfMake.createPdf(definition); }
    document.getElementById('download-pdf').onclick = () => { try { create().download(filename); } catch (_) { failed(); } };
    document.getElementById('open-pdf').onclick = () => { try { create().open(); } catch (_) { failed(); } };
    try {
        document.getElementById('download-pdf').disabled = false; document.getElementById('open-pdf').disabled = false;
        document.getElementById('pdf-status').textContent = 'Your PDF is ready. Use the button below if the download does not start.';
        create().download(filename);
    } catch (_) { failed(); }
}());
