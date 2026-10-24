(function () {
    'use strict';
    const status=document.getElementById('room-pdf-status'),error=document.getElementById('room-pdf-error');
    try {
        if(!window.pdfMake)throw new Error('The PDF library could not be loaded. Check your connection and reload this page.');
        const source=JSON.parse(document.getElementById('room-pdf-data').textContent),plan=source.plan,request=source.type==='request';
        const colours={planned:'#e5efff',requested:'#fff0c9',confirmed:'#dcefe3',rejected:'#f8dfe2',cancelled:'#e9ecef'};
        const reservations=request?plan.request.bookings:plan.bookings;
        const body=[[{text:'Raum',style:'tableHeading'},{text:'Zeitraum',style:'tableHeading'},{text:'Verwendung / Bemerkungen',style:'tableHeading'},...(!request?[{text:'Status',style:'tableHeading'}]:[])]];
        reservations.forEach(r=>{
            const purpose=[{text:r.roomReservations_purpose,bold:true}];
            if(r.roomReservations_notes)purpose.push({text:r.roomReservations_notes,margin:[0,4,0,0]});
            if(!request && r.conflicts?.length)purpose.push({text:r.conflicts.map(c=>(c.severity==='confirmed'?'Bestätigte Überschneidung':'Mögliche Überschneidung')+': '+c.projects_name+' · '+c.period).join('\n'),color:'#9a3412',fontSize:8,margin:[0,5,0,0]});
            body.push([
                {stack:[{text:r.rooms_name+(r.rooms_number?' ('+r.rooms_number+')':''),bold:true},{text:r.building || '',fontSize:8,color:'#596575',margin:[0,3,0,0]}]},
                {stack:[{text:r.period,fontSize:9},...(request?[{text:plan.statuses[r.roomReservations_status],fontSize:8,color:'#596575',margin:[0,4,0,0]}]:[])]},
                {stack:purpose},
                ...(!request?[{text:plan.statuses[r.roomReservations_status],fillColor:colours[r.roomReservations_status],fontSize:8}]:[])
            ]);
        });
        const title=request?'Raumanfrage':'Raumplanung';
        const heading={stack:[{text:source.business || 'AdamRMS',fontSize:10,color:'#596575',margin:[0,0,0,8]},{text:title,fontSize:23,bold:true,color:'#1e3347'},{text:plan.project.projects_name,fontSize:15,margin:[0,5,0,0]}],width:'*'};
        const content=[{columns:[heading,...(source.logo?[{image:source.logo,fit:[85,55],alignment:'right',width:90}]:[])],margin:[0,0,0,17]}];
        if(plan.request.eventDates)content.push({text:'Veranstaltungsdatum: '+plan.request.eventDates,margin:[0,0,0,5]});
        content.push({text:'Zeitzone: '+plan.timeZone,fontSize:9,color:'#596575',margin:[0,0,0,15]});
        if(request)content.push({text:'Für die Veranstaltung werden folgende Räume benötigt. Bitte prüfen Sie die Verfügbarkeit und bestätigen Sie die Reservierung.',margin:[0,0,0,13]});
        else content.push({text:plan.summary.rooms+' Räume · '+plan.summary.confirmed+' bestätigt · '+plan.summary.open+' offen · '+plan.summary.conflicts+' Überschneidungen',margin:[0,0,0,13],fontSize:10});
        if(reservations.length)content.push({table:{headerRows:1,widths:request?[95,132,'*']:[85,126,'*',62],body},layout:{
            hLineWidth:(i)=>i===0?0:0.5,vLineWidth:()=>0,hLineColor:()=>'#dce1e6',
            paddingTop:()=>9,paddingBottom:()=>9,paddingLeft:()=>7,paddingRight:()=>7,
            fillColor:(i)=>i===0?'#edf1f5':null
        }});
        else content.push({text:request?'Keine offenen Raumbelegungen vorhanden.':'Keine Raumbelegungen vorhanden.',margin:[0,8,0,18]});
        content.push({text:request?'Vielen Dank für Ihre Rückmeldung. Dieser Entwurf enthält ausschließlich Planned- und Requested-Belegungen. Der Export ändert keinen Reservierungsstatus.':'Confirmed wird intern manuell gesetzt und ersetzt keine Reservierung im offiziellen Schulverwaltungssystem. Abgelehnte und stornierte Belegungen lösen keine aktiven Konflikte aus.',fontSize:8,color:'#596575',margin:[0,17,0,0]});
        const definition={pageSize:'A4',pageOrientation:'portrait',pageMargins:[36,35,36,45],defaultStyle:{font:'Roboto',fontSize:10,lineHeight:1.18},styles:{tableHeading:{bold:true,color:'#253b50',fontSize:9}},content,footer:(page,pages)=>({columns:[{text:source.date,alignment:'left'},{text:page+' / '+pages,alignment:'right'}],fontSize:8,color:'#697581',margin:[36,15,36,0]}),info:{title:title+' - '+plan.project.projects_name,author:source.business || 'AdamRMS',subject:request?'Raumanfrage':'Raumplanung'}};
        // Expose the same definition used by the buttons for automated PDF layout verification.
        window.roomPdfDefinition=definition;
        const file=(request?'Raumanfrage':'Raumplanung')+'-'+plan.project.projects_id+'.pdf';
        document.getElementById('room-pdf-download').onclick=()=>window.pdfMake.createPdf(definition).download(file);
        document.getElementById('room-pdf-open').onclick=()=>window.pdfMake.createPdf(definition).open();
        document.getElementById('room-pdf-download').disabled=false;document.getElementById('room-pdf-open').disabled=false;
        status.textContent='Your PDF is ready. '+reservations.length+' reservations.';
    }catch(e){error.textContent=e.message;status.textContent='PDF could not be prepared.';}
})();
