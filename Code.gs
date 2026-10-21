/**
 * INTEGRATED SUPERVISION WEST REGION — Projet ATHECS
 * Google Apps Script API  ·  NACC powered by ICAP Global Health © 2025-2026
 *
 * This script is the ONLY door to the data. The spreadsheet itself must never be
 * shared with supervisors: every role check happens here, on the server.
 *
 * SETUP (10 minutes) — see DEPLOIEMENT.md
 *   1. Open the sheet, Extensions ▸ Apps Script, paste this file, Save.
 *   2. Run  setup()  once (authorise when asked). It creates every tab.
 *   3. Deploy ▸ New deployment ▸ Web app
 *        Execute as: Me      Who has access: Anyone
 *      Copy the /exec URL.
 *   4. In the app: Console Super Utilisateur ▸ Paramètres ▸ paste the URL ▸ Save.
 */

var SCRIPT_VERSION = '4.14.0';   // the app checks this: a mismatch means an old deployment

/* The version of index.html the region is supposed to be running. Every phone
   compares its own APP_VERSION against this on every single pull, and says so
   on screen when it is behind. It is here, and not in the app, because a phone
   running an old app cannot know that it is old — that was exactly the v4.0.0
   problem: the phone had no way to learn the news, and the news had no way to
   reach the phone. Raise this line when you upload a new index.html. */
var APP_EXPECTED = '4.14.0';

/* ═══════════════════════════════════════════════════════════════════════════
   ▼▼▼  VOTRE COMPTE ADMINISTRATEUR — ÉCRIVEZ VOS DEUX LIGNES ICI  ▼▼▼

   Le bouton « Exécuter » d'Apps Script ne sait PAS passer d'arguments à une
   fonction : il l'appelle toujours à vide. C'est pourquoi on met le nom ici,
   dans le fichier, plutôt que dans la parenthèse.

   1. Remplacez les deux lignes ci-dessous par votre nom et votre téléphone.
   2. Enregistrez (icône disquette).
   3. En haut, choisissez la fonction  activerAdmin  puis Exécuter.
   4. Le journal d'exécution affiche votre code à 6 chiffres.

   Un nom vide = aucun compte visible dans l'application. C'est obligatoire.
   ═══════════════════════════════════════════════════════════════════════════ */
var MON_NOM       = 'Che Frankline ANYIANG';
var MON_TELEPHONE = '+237690000001';

/** Exécutez CETTE fonction depuis l'éditeur : elle ne prend aucun argument. */
function activerAdmin(){
  var out = nouveauCodeAdmin('A001', MON_NOM, MON_TELEPHONE);
  Logger.log(out);
  return out;
}
/** Le deuxième administrateur, si vous en voulez un. Changez MON_NOM d'abord. */
function activerAdmin2(){
  var out = nouveauCodeAdmin('A002', MON_NOM, MON_TELEPHONE);
  Logger.log(out);
  return out;
}
/** Qui occupe quoi, en une ligne chacun. Utile quand plus rien n'est clair. */
function etatDesComptes(){
  var out = ADMIN_SLOTS.concat(SUPER_SLOTS).map(function(sl){
    var r = userRow(sl.id) || {};
    var nom = String(r['name']||'').trim();
    return sl.id + ' · ' + (r['role']||'?') + ' · '
         + (nom ? nom : '— AUCUN NOM : invisible dans l\'application —')
         + (String(r['claimed_at']||'') ? ' · activé' : (nom ? ' · en attente d\'activation' : ''));
  }).join('\n');
  out = 'VERSION DU SCRIPT : ' + SCRIPT_VERSION + '\n\n' + out;
  Logger.log(out);
  return out;
}

/* ---------------------------------------------------------------------------
   THE PRIVILEGED SLOTS
   Two administrators and two super users. They are never enrolled like a
   supervisor: a slot is ASSIGNED, which generates a random 6-digit code, and
   the person claims it on their own phone with that code and then chooses
   their own PIN. No PIN is ever stored here or baked into the app.

   ADMIN is the root of trust: its claim code can only be produced from THIS
   editor, by running nouveauCodeAdmin('A001'). Whoever owns this workbook
   controls who administers the region — nobody else can. */
var ADMIN_SLOTS = [
  {id:'A001', label:'Administrateur 1'},
  {id:'A002', label:'Administrateur 2'}
];
/* Six, for twenty districts and eighty-four facilities. Raised from two on 14 Sep 2026:
   a supervision cycle generates more approvals than two people can carry.
   ensureSlots() only ADDS what is missing, so U001 and U002 keep their holder, their
   claim and their PIN — running setup() after this change touches neither. */
var SUPER_SLOTS = [
  {id:'U001', label:'Super utilisateur 1'},
  {id:'U002', label:'Super utilisateur 2'},
  {id:'U003', label:'Super utilisateur 3'},
  {id:'U004', label:'Super utilisateur 4'},
  {id:'U005', label:'Super utilisateur 5'},
  {id:'U006', label:'Super utilisateur 6'}
];
var CLAIM_TTL = 24*3600*1000;
var SHEET_ID = '1tmejPIhf6L2mkL7CkZZ_0Sllcz8-So96Qh4v-SewqAo';
var TOKEN    = 'ATHECS';                 // change this, and change it in the app too
var DRIVE_FOLDER = 'ATHECS - Pieces justificatives';

var TABS = {
  USERS:    ['user_id','name','role','function','matricule','id_type','id_number','phone','email','districts',
             'sites','status','active','pin_reset_code','pin_reset_at','pin_help_at',
             'approved_by','approved_at','decision_note','device','enrolled_at','updated_at',
             /* privileged slots only: a slot with no claimed_at is "à activer" and accepts
                nothing but its claim code. Claiming burns the code and stamps claimed_at. */
             'claim_code','claim_code_at','claimed_at','assigned_by','assigned_at',
             /* ONE PERSON, TWO HATS. `dual` is explicit and never inferred: facility
                staff also carry a district, so guessing from the columns would hand
                people a supervisor role nobody gave them. The req_* cells hold a
                PENDING request and nothing else — they can never grant anything. */
             'dual','req_role','req_scope','req_fn','req_at','req_status','req_note','req_by'],
  SITES:    ['site_id','district','area','facility','status','version','updated_at'],
  SITE_REQUESTS: ['request_id','ref','type','site_id','district_before','area_before','facility_before',
                  'district_after','area_after','facility_after','source','doc_ref','doc_date','doc_file_url',
                  'requester','requester_uid','function','matricule','id_type','id_number','phone','email',
                  'justification','gps_lat','gps_lng','status','decided_by','decided_at','decision_note','submitted_at'],
  QUESTIONS:['question_code','n','section','question_fr','type','domain','numerator','denominator',
             'default_den','weight','follow_up','is_dqa','per_month','active','version','items',
             /* v4.3.1 — a question is more than a wording and a type, and every one of
                these was being silently dropped on the way back to the phones */
             'subtitle','gate','den_from','sample_group','no_child','sort_order'],
  CYCLES:   ['cycle_id','name','fy','quarter','months','months_complete','open','close','deadline','status','raw'],
  VISITS:   ['visit_id','cycle_id','site_id','district','area','facility','supervisor','supervisor_uid',
             'visit_date','team','status','score_overall','score_clinical','score_mne',
             'answered','na_count','submitted_at','reviewed_by','reviewed_at','review_note',
             'months_complete','updated_at','conflict','raw'],
  VARCHIVE: ['visit_id','cycle_id','site_id','facility','supervisor','visit_date','status',
             'kept_id','archived_by','archived_at','raw'],
  ANSWERS:  ['visit_id','question_code','n','month','section','domain','numerator','denominator',
             'na','na_reason','score_pct','band','comment','raw'],
  SWOT:     ['visit_id','forces','faiblesses','opportunites','menaces'],
  ACTIONS:  ['action_id','visit_id','site_id','cycle_id','question_code','section','root_cause',
             'action_onsite','recommendation','responsible','deadline','status','site_note','created_at','updated_at'],
  MESSAGES: ['message_id','thread_id','scope','site_id','author_uid','author','body','sent_at'],
  THREADS:  ['thread_id','scope','site_id','visit_id','title','members','created_at'],
  AUDIT:    ['event_id','timestamp','user','user_id','action','entity','detail'],
  SETTINGS: ['key','value','updated_at'],
  /* A merged-away account is never destroyed: its whole record is kept here, with who
     merged it, when, and which account it became. */
  ARCHIVE:  ['archived_id','became_id','name','role','archived_by','archived_at','reason','raw'],
  /* The mapping the phones read, so a device still holding the dropped account swaps to
     the surviving one by itself instead of asking the person to enrol again. */
  MERGES:   ['drop_id','keep_id','merged_by','merged_at'],

  /* ─────────────────────────────────────────────────────────────────────
     DECLARATIONS — a road of its own.                          (v4.6.0)

     One-off requests sent to the sites: the CDC Foundational Milestone
     first, others after it. They are NOT supervisions and they share
     nothing with them — not a sheet, not a sync kind, not a score. The
     mentorship data is live and must stay exactly as it is.

     Each form carries its own LAYOUT, because each will be shaped
     differently. That is why `layout` is a JSON blob rather than columns:
     a fixed schema could serve one document and never the next. The app
     renders whatever the layout describes, so a new request is rows typed
     into this workbook — no new version of the app, no new link, and
     nothing added to its weight.

     Retiring one is a single cell: status ARCHIVED hides it from every
     phone and keeps the answers. Delete the rows to be rid of it.
     ───────────────────────────────────────────────────────────────────── */
  /* `layout` is a JSON blob. A Sheets cell holds 50,000 characters and the AHD
     readiness tool's layout is nearly 40,000 on its own, so a layout may span
     several cells and is joined back together on the way out. One cell was
     enough for the Foundational Milestone and will not be enough for the next
     instrument. */
  FORMS:        ['form_id','title','subtitle','status','scope','fillers',
                 'opens','closes','version','updated_by','updated_at',
                 'layout','layout2','layout3','layout4'],
  FORM_ENTRIES: ['entry_id','form_id','site_id','district','area','facility',
                 'sent_back_by','sent_back_at','sent_back_why',
                 'status','filled_by','filled_uid','filled_at','updated_at','data',
                 /* `content_hash` is what a signature is a signature OF. Change an
                    answer and the hash changes, which is how a signature given
                    before the change is known to be stale rather than trusted. */
                 'content_hash','approved_by','approved_uid','approved_at'],

  /* One row per signature given. Keeping them out of FORM_ENTRIES means a
     signature can be voided without touching a site's answers, and the sheet
     reads as what it is: a register of who certified what, and when. */
  FORM_SIGNATURES: ['sig_id','form_id','role','site_id','signer_name','signer_title',
                    'signer_uid','signed_at','covers_hash','status','ink'],

  /* A page that was deleted. Without this a phone that already holds it would
     keep it for ever: the row is gone from the server, so nothing would ever
     mention it again. The same reasoning as VARCHIVE for supervisions. */
  FORM_GONE:    ['entry_id','form_id','site_id','deleted_by','deleted_at']
};

/* ------------------------------------------------------------------ setup */
function setup(){
  var ss = SpreadsheetApp.openById(SHEET_ID);
  Object.keys(TABS).forEach(function(name){
    var sh = ss.getSheetByName(name);
    if(!sh) sh = ss.insertSheet(name);
    if(sh.getLastRow() === 0){
      sh.getRange(1,1,1,TABS[name].length).setValues([TABS[name]])
        .setFontWeight('bold').setBackground('#0B3C71').setFontColor('#FFFFFF');
      sh.setFrozenRows(1);
    } else {
      addMissingColumns(sh, TABS[name]);   // safe upgrade: keeps every existing row
    }
    sh.protect().setWarningOnly(true);
  });
  ensureSlots();
  var def = ss.getSheetByName('Sheet1') || ss.getSheetByName('Feuille 1');
  if(def && ss.getSheets().length > 1 && def.getLastRow() === 0) ss.deleteSheet(def);
  driveFolder();
  return 'OK — ' + Object.keys(TABS).length + ' tabs ready.';
}
/** The eight privileged slots (2 administrators + 6 super users) exist from the first
 *  setup(), unassigned and unclaimable.
 *  An unassigned slot has no name, so it appears nowhere and can be signed into by nobody. */
function ensureSlots(){
  ADMIN_SLOTS.concat(SUPER_SLOTS).forEach(function(sl){
    if(userRow(sl.id)) return;
    upsert('USERS','user_id',sl.id,{
      user_id:sl.id, name:'', role:(sl.id.charAt(0)==='A'?'ADMIN':'SUPER'),
      districts:'ALL', status:'ACTIVE', active:true, updated_at:new Date()});
  });
}

/** Append any header this version expects but the sheet does not have yet.
 *  Existing data is never moved, reordered or deleted. Re-running setup() is safe. */
function addMissingColumns(sh, wanted){
  var have = sh.getRange(1,1,1,Math.max(1,sh.getLastColumn())).getValues()[0]
               .map(function(h){ return String(h).trim(); });
  var missing = wanted.filter(function(w){ return have.indexOf(w) === -1; });
  if(!missing.length) return 0;
  sh.getRange(1, have.length + 1, 1, missing.length).setValues([missing])
    .setFontWeight('bold').setBackground('#0B3C71').setFontColor('#FFFFFF');
  return missing.length;
}

function driveFolder(){
  var it = DriveApp.getFoldersByName(DRIVE_FOLDER);
  return it.hasNext() ? it.next() : DriveApp.createFolder(DRIVE_FOLDER);
}
function sheet(name){
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sh = ss.getSheetByName(name);
  if(!sh){ setup(); sh = ss.getSheetByName(name); }
  return sh;
}
/** Address columns by HEADER NAME, never by position — a reordered column must not break the API. */
function headerMap(sh){
  var h = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0];
  var m = {}; h.forEach(function(k,i){ m[String(k).trim()] = i; });
  return m;
}
/** Write a row by HEADER NAME.
 *
 *  This used to build the row in TABS order and drop it into columns 1..N. That is only
 *  correct while the sheet's physical column order happens to match TABS. It does not:
 *  addMissingColumns() appends a new column at the END of the sheet, while a new field
 *  added to TABS usually sits in the middle. From then on every value after the first
 *  divergence lands one column to the side — a status cell receives the "active" flag, a
 *  sites cell receives a date or a device string. That is what put approved supervisors
 *  on the "enrolment refused" screen.
 *
 *  Now each value is placed at the position the SHEET gives that header, so the physical
 *  order can be anything at all. Columns the sheet does not have are skipped, never shifted. */
function upsert(name, keyCol, keyVal, obj){
  var sh = sheet(name), map = headerMap(sh);
  var width = sh.getLastColumn();
  var row = new Array(width).fill('');
  Object.keys(obj).forEach(function(c){
    var i = map[c];
    if(i === undefined || i >= width) return;
    if(obj[c] !== undefined && obj[c] !== null) row[i] = obj[c];
  });
  var last = sh.getLastRow();
  if(last > 1 && keyCol && map[keyCol] !== undefined){
    var ki = map[keyCol];
    var keys = sh.getRange(2, ki+1, last-1, 1).getValues();
    for(var r=0; r<keys.length; r++){
      if(String(keys[r][0]) === String(keyVal)){
        sh.getRange(r+2, 1, 1, width).setValues([row]); return 'updated';
      }
    }
  }
  sh.getRange(sh.getLastRow()+1, 1, 1, width).setValues([row]); return 'inserted';
}
/* upsert() writes a WHOLE row: every column it is not given is blanked. That
   is what we want when the app sends a complete record, and exactly what we
   must not do when changing one field. patch() reads the row that is there
   and writes it back with the change applied. */
function patch(name, keyCol, keyVal, obj){
  var cur = null, rows = rowsOf(name);
  for(var i = 0; i < rows.length; i++){
    if(String(rows[i][keyCol]) === String(keyVal)){ cur = rows[i]; break; }
  }
  if(!cur) return 'missing';
  Object.keys(obj).forEach(function(k){ cur[k] = obj[k]; });
  return upsert(name, keyCol, keyVal, cur);
}
function saveFile(dataUrl, name){
  if(!dataUrl || dataUrl.indexOf('base64,') < 0) return '';
  try{
    var parts = dataUrl.split(','), meta = parts[0];
    var type = meta.substring(meta.indexOf(':')+1, meta.indexOf(';'));
    var blob = Utilities.newBlob(Utilities.base64Decode(parts[1]), type, name);
    var f = driveFolder().createFile(blob);
    f.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
    return f.getUrl();
  }catch(e){ return 'ERR:'+e; }
}

/* ------------------------------------------------------------------ API */
function doPost(e){
  var lock = LockService.getScriptLock();
  try{
    /* Eight seconds, not twenty-five. A write that cannot start in eight seconds is
       queued behind something long, and the honest answer is to say so and let the phone
       come back — it keeps everything in its outbox and loses nothing. Twenty-five
       seconds of silence is long enough for a phone on mobile data to give up on the
       request entirely, and the app then reported a refusal that had never happened. */
    if(!lock.tryLock(8000))
      return json({ok:false, busy:true, error:'server busy — another write is in progress'});
    var b = JSON.parse(e.postData.contents);
    if(b.token !== TOKEN) return json({ok:false, error:'bad token'});
    var p = b.payload;

    /* ---- NOTHING FROM BEFORE THE RESET MAY COME BACK ---------------------------------
       A phone that was offline when the workbook was reset still holds its test
       supervisions in its outbox. On the next launch the app fires its push and its reads
       at the same moment, unordered — so the push can win, and the test data lands back in
       a workbook that was just cleaned. The phone then wipes itself, and the rows stay on
       the server for ever.

       The reset line belongs to the server, not to the ordering of two requests. Anything
       generated BEFORE the reset is test data by definition and is refused here — with
       ok:true, so the phone lets go of it instead of retrying for ever, and with a line in
       the Journal so nothing disappears in silence. */
    var dropped = beforeReset(b.kind, p);
    if(dropped) return json({ok:true, dropped:true, why:'generated before the reset'});

    switch(b.kind){
      case 'user':      saveUser(p); break;
      case 'userFlag':  setUserFlags(p); break;
      case 'siteReq':   saveSiteReq(p); break;
      case 'visit':     saveVisit(p); break;
      case 'message':   saveMessage(p); break;
      case 'thread':    saveThread(p); break;
      case 'questions': saveQuestions(p); break;
      case 'cycle':     saveCycle(p); break;
      case 'audit':     saveAudit(p); break;
      case 'merge':     return json(mergeAccounts(p));
      case 'assign':    return json(assignSlot(p));
      case 'release':   return json(releaseSlot(p));
      case 'resolve':   return json(resolveConflict(p));
      case 'roleReq':   return json(roleRequest(p));
      case 'roleGrant': return json(roleGrant(p));
      case 'scopeSet':  return json(scopeSet(p));
      case 'penSet':    return json(penSet(p));
      case 'penReq':    return json(penReq(p));
      case 'qPublish':  return json(publishQuestions(p));
      case 'formPublish': return json(publishForm(p));
      case 'formEntry':   return json(saveFormEntry(p));
      case 'formApprove': return json(approveFormEntry(p));
      case 'formSign':    return json(signForm(p));
      case 'formDelete':  return json(deleteFormEntry(p));
      case 'roleRevoke':return json(roleRevoke(p));
      default: return json({ok:false, error:'unknown kind '+b.kind});
    }
    return json({ok:true, id:b.id});
  }catch(err){
    return json({ok:false, error:String(err)});
  }finally{
    try{ lock.releaseLock(); }catch(x){}
  }
}
function doGet(e){
  var p = (e && e.parameter) || {};

  /* The public dashboard, and ONLY the public dashboard, is answered before
     the main password is checked — it has its own, and it must never be
     reachable with the supervisors' one. See dashPayload() at the end of
     this file for what it may and may not return. */
  if(p.action === 'dash'){
    if(String(p.rtoken || '') !== DASH_TOKEN)
      return json({ok:false, error:'bad dashboard token'});
    try{ return json(dashPayload(String(p.cycle || ''))); }
    catch(err){ return json({ok:false, error:String(err && err.message || err)}); }
  }

  if(p.token !== TOKEN) return json({ok:false, error:'bad token'});
  if(p.action === 'pull'){
    var sh = sheet('MESSAGES'), out = [];
    var last = sh.getLastRow();
    if(last > 1){
      var rows = sh.getRange(2,1,last-1,TABS.MESSAGES.length).getValues();
      var since = Number(p.since || 0);
      rows.forEach(function(r){
        var ts = new Date(r[7]).getTime();
        if(ts > since) out.push({id:r[0], threadId:r[1], scope:r[2], siteId:r[3],
                                 uid:r[4], who:r[5], body:r[6], ts:ts, read:[]});
      });
    }
    /* the conversations themselves travel with every pull: they are a handful of
       rows, and a message whose thread is missing is a message nobody can see */
    var threads = rowsOf('THREADS').map(function(r){
      return {id:String(r.thread_id), scope:r.scope||'GENERAL', siteId:r.site_id||'',
              visitId:r.visit_id||'', title:r.title||'',
              members:String(r.members||'').split(',').map(function(x){return x.trim();}).filter(Boolean),
              created:tms(r.created_at)||0};
    }).filter(function(t){ return t.id; });
    return json({ok:true, messages: out.slice(-200), threads: threads});
  }
  /* One device asking about itself: status, districts, PIN-reset code. */
  if(p.action === 'userstate'){
    var uid = String(p.uid||'');
    var one = userRows().filter(function(u){ return String(u.id) === uid; })[0];
    return json(withReset({ok:true, user: one || null}));
  }
  /* Central console: the roster, without PINs and without ID numbers. */
  if(p.action === 'users'){
    return json(withReset({ok:true, users: userRows()}));
  }
  /* The claim code, tested here and nowhere else. Burned on acceptance. */
  if(p.action === 'claim') return json(claimSlot(p));

  /* The privileged slots as every phone must see them: assigned or not, claimed or
     not. This is what lets the sign-in screen show "à activer" and refuse a PIN, and what
     makes a released slot disappear from the phone of whoever used to hold it. */
  if(p.action === 'slots'){
    var all = ADMIN_SLOTS.concat(SUPER_SLOTS).map(function(sl){
      var r = userRow(sl.id) || {};
      return {id:sl.id, label:sl.label,
              role:(sl.id.charAt(0)==='A'?'ADMIN':'SUPER'),
              name:String(r['name']||''),
              phone:String(r['phone']||''),
              assigned: !!String(r['name']||'').trim(),
              claimed: !!r['claimed_at'],
              active: r['active'] !== false && String(r['active']).toLowerCase() !== 'false'};
    });
    return json(withReset({ok:true, slots: all}));
  }

  /* Every device, whatever the role: the administrators' names and phone numbers.
     Nothing else — no PIN, no identity document, no other user. This is what makes
     a renamed super user appear under the new name on every phone. */
  if(p.action === 'admins'){
    var adm = userRows().filter(function(u){
        return (String(u.role) === 'SUPER' || String(u.role) === 'ADMIN')
            && String(u.name||'').trim();
      }).map(function(u){ return {id:u.id, name:u.name, phone:u.phone, role:u.role}; });
    return json(withReset({ok:true, admins: adm}));
  }
  /* The ONE place a temporary code is ever tested. The code is compared on the server
     and never sent back. A valid code is burned immediately: single use, and 24 hours
     of validity at most. Anything else answers a flat false. */
  if(p.action === 'pincheck'){
    var lk = LockService.getScriptLock();
    try{
      lk.waitLock(15000);
      var sh = sheet('USERS'), map = headerMap(sh), last = sh.getLastRow();
      if(last < 2) return json({ok:true, valid:false});
      var ids = sh.getRange(2, map['user_id']+1, last-1, 1).getValues();
      for(var i=0;i<ids.length;i++){
        if(String(ids[i][0]) !== String(p.uid||'')) continue;
        var row = i+2;
        var code = String(sh.getRange(row, map['pin_reset_code']+1).getValue()||'');
        var at   = sh.getRange(row, map['pin_reset_at']+1).getValue();
        var age  = at ? (new Date().getTime() - new Date(at).getTime()) : Infinity;
        if(!code || code !== String(p.code||'') || age > 24*3600*1000) return json({ok:true, valid:false});
        sh.getRange(row, map['pin_reset_code']+1).setValue('');
        sh.getRange(row, map['pin_reset_at']+1).setValue('');
        sh.getRange(row, map['pin_help_at']+1).setValue('');
        return json({ok:true, valid:true});
      }
      return json({ok:true, valid:false});
    }catch(err){ return json({ok:false, error:String(err)}); }
    finally{ try{ lk.releaseLock(); }catch(x){} }
  }
  /* ==================================================================
     THE MISSING HALF OF THE SYNC.
     Every phone pushed its work here and nothing ever came back except
     messages and the user roster. A supervision submitted on a
     supervisor's phone therefore never reached the console, so the
     coordination team had nothing to approve, and the facility's own
     focal point never received the report.
     This returns everything that changed since the caller last asked.
     ================================================================== */
  if(p.action === 'data'){
    var since = Number(p.since || 0);
    var full  = String(p.full || '') === '1';
    var out   = { ok:true, now: new Date().getTime(), version: SCRIPT_VERSION,
                  appExpected: APP_EXPECTED };

    var vRows = rowsOf('VISITS');
    var changed = vRows.filter(function(r){
      return tms(r.updated_at) > since || tms(r.submitted_at) > since;
    });
    var wanted = {};
    out.visits = changed.map(function(r){
      wanted[String(r.visit_id)] = 1;
      return reviveVisit(r);
    });

    out.answers = {};
    rowsOf('ANSWERS').forEach(function(r){
      var vid = String(r.visit_id); if(!wanted[vid]) return;
      var a; try{ a = JSON.parse(r.raw || 'null'); }catch(e){ a = null; }
      if(!a) a = flatAnswer(r);
      (out.answers[vid] = out.answers[vid] || {})[String(r.question_code)] = a;
    });

    out.swot = rowsOf('SWOT').filter(function(r){ return wanted[String(r.visit_id)]; })
      .map(function(r){ return {visitId:String(r.visit_id),
        f:r.forces||'', w:r.faiblesses||'', o:r.opportunites||'', t:r.menaces||''}; });

    /* A recommendation moves on its own clock: the facility closes it long after the
       supervision was submitted. So it is pulled on its own updated_at, not the visit's. */
    out.actions = rowsOf('ACTIONS')
      .filter(function(r){ return tms(r.updated_at) > since || wanted[String(r.visit_id)]; })
      .map(function(r){ return {
        id:String(r.action_id), visitId:String(r.visit_id), siteId:String(r.site_id),
        cycleId:String(r.cycle_id||''), qid:String(r.question_code||''), sec:r.section||'',
        root:r.root_cause||'', onsite:r.action_onsite||'', reco:r.recommendation||'',
        resp:r.responsible||'', deadline:fmtDate(r.deadline), status:r.status||'OPEN',
        siteNote:r.site_note||'', created:tms(r.created_at), updated:tms(r.updated_at) }; });

    out.siteReq = rowsOf('SITE_REQUESTS')
      .filter(function(r){ return tms(r.decided_at) > since || tms(r.submitted_at) > since; })
      .map(function(r){ return {
        id:String(r.request_id), ref:r.ref, type:r.type, siteId:String(r.site_id||''),
        before:{district:r.district_before, area:r.area_before, facility:r.facility_before},
        after:{district:r.district_after, area:r.area_after, facility:r.facility_after},
        source:r.source, docRef:r.doc_ref, docDate:fmtDate(r.doc_date), docFile:r.doc_file_url,
        reqName:r.requester, reqUid:r.requester_uid, reqFn:r['function'], reqMat:r.matricule,
        idType:r.id_type, phone:r.phone, email:r.email, justification:r.justification,
        status:r.status, decidedBy:r.decided_by, decidedAt:tms(r.decided_at),
        decisionNote:r.decision_note }; });

    /* A supervision archived after a double submission is DELETED from VISITS, so it
       would otherwise sit for ever on the phones that already had it — counting in
       nothing on the server and in everything on the phone. They learn it is gone here. */
    /* Declarations travel on every pull. They are small — a handful of rows —
       and a form nobody can see is a form nobody fills. */
    out.forms = rowsOf('FORMS').filter(function(r){
      return String(r.form_id || '') && String(r.status || '') !== 'ARCHIVED';
    }).map(function(r){
      var layout = null;
      var joined = String(r.layout || '') + String(r.layout2 || '')
                 + String(r.layout3 || '') + String(r.layout4 || '');
      try{ layout = JSON.parse(joined || 'null'); }catch(e){ layout = null; }
      return {id:String(r.form_id), title:String(r.title || ''),
              subtitle:String(r.subtitle || ''), status:String(r.status || 'DRAFT'),
              scope:String(r.scope || 'SITE'), fillers:String(r.fillers || 'SUPER'),
              opens:fmtDate(r.opens), closes:fmtDate(r.closes),
              version:Number(r.version) || 1, layout:layout};
    });
    out.formEntries = rowsOf('FORM_ENTRIES').filter(function(r){
      return tms(r.updated_at) > since;
    }).map(function(r){
      var data = null;
      try{ data = JSON.parse(String(r.data || 'null')); }catch(e){ data = null; }
      return {id:String(r.entry_id), formId:String(r.form_id || ''),
              siteId:String(r.site_id || ''), status:String(r.status || 'DRAFT'),
              by:String(r.filled_by || ''), uid:String(r.filled_uid || ''),
              at:tms(r.filled_at) || 0,
              updated:tms(r.updated_at) || 0, hash:String(r.content_hash || ''),
              approvedBy:String(r.approved_by || ''), approvedAt:tms(r.approved_at) || 0,
              sentBack: String(r.sent_back_by || '') ? {by:String(r.sent_back_by),
                at:tms(r.sent_back_at) || 0, why:String(r.sent_back_why || '')} : null,
              data:data};
    });

    /* Pages deleted since this phone last asked, so it drops its copy too. */
    out.formGone = rowsOf('FORM_GONE').filter(function(r){
      return tms(r.deleted_at) > since;
    }).map(function(r){ return {id:String(r.entry_id), formId:String(r.form_id || ''),
      siteId:String(r.site_id || ''), at:tms(r.deleted_at) || 0}; });

    /* Who may sign. The app cannot know this on its own, and a phone that does
       not know shows no Sign button to the very people who must sign. */
    out.formOfficers = {bo:String(getSetting('fm_bo_uid') || ''),
                        pi:String(getSetting('fm_pi_uid') || '')};

    /* Signatures travel too, so the phone that prints is the phone that knows
       whether the page it is about to print is certified. The drawn signature
       itself goes only to an account the workbook names as BO or PI. */
    /* A drawn signature is a forgery tool if it is handed to every phone that
       holds the app's token. It is sent only to the two people who gave it and
       to the accounts the workbook names as assembling the submission. Everyone
       else learns that a signature exists, not what it looks like. */
    var signer  = String(p.uid || '');
    var boUid   = String(getSetting('fm_bo_uid') || '');
    var piUid   = String(getSetting('fm_pi_uid') || '');
    var mayInk  = signer && (signer === boUid || signer === piUid ||
                  String(getSetting('fm_print_uids') || '').split(/[,;\s]+/)
                    .indexOf(signer) >= 0);
    out.formSignatures = rowsOf('FORM_SIGNATURES').filter(function(r){
      return String(r.sig_id || '');
    }).map(function(r){
      var o = {id:String(r.sig_id), formId:String(r.form_id || ''),
               role:String(r.role || ''), siteId:String(r.site_id || ''),
               name:String(r.signer_name || ''), title:String(r.signer_title || ''),
               at:tms(r.signed_at) || 0, covers:String(r.covers_hash || ''),
               status:String(r.status || 'VALID')};
      if(mayInk) o.ink = String(r.ink || '');
      return o;
    });

    out.varchive = rowsOf('VARCHIVE').filter(function(r){ return tms(r.archived_at) > since; })
      .map(function(r){ return {id:String(r.visit_id), keptId:String(r.kept_id||''),
        at:tms(r.archived_at)}; });

    /* A phone still holding a merged-away account learns its new id from here. */
    out.merges = rowsOf('MERGES').filter(function(r){ return tms(r.merged_at) > since; })
      .map(function(r){ return {drop:String(r.drop_id), keep:String(r.keep_id),
        by:r.merged_by, at:tms(r.merged_at)}; });

    /* The console's Journal must be the REGION's history, not this one console's.
       Without this, a verification mission asking "who approved that?" gets an answer
       only if it happens to be holding the phone that did it. */
    out.audit = rowsOf('AUDIT').filter(function(r){ return tms(r.timestamp) > since; })
      .map(function(r){ return {id:String(r.event_id), ts:tms(r.timestamp), user:r.user,
        uid:String(r.user_id||''), action:r.action, entity:r.entity, detail:r.detail,
        remote:true}; }).slice(-800);

    /* The reference data changes rarely and is bulky, so it travels only when asked for. */
    if(full){
      out.cycles = rowsOf('CYCLES').map(reviveCycle).filter(function(c){ return c && c.id && c.months.length; });

      /* the phones need to know WHICH questionnaire this is, or they cannot tell a
         newer one from an older one */
      out.qversion = String(getSetting('questionnaire_version')||'');
      out.questions = rowsOf('QUESTIONS').map(function(r){
        var items=null; try{ items = r.items? JSON.parse(r.items) : null; }catch(e){}
        var o = {id:String(r.question_code), code:String(r.question_code), n:Number(r.n)||0,
          sec:r.section, q:r.question_fr, type:r.type, dom:r.domain,
          weight:Number(r.weight)||1, active:String(r.active)!=='false' && r.active!==false,
          version:Number(r.version)||1};
        if(r.numerator)   o.num = r.numerator;
        if(r.denominator) o.den = r.denominator;
        if(r.default_den) o.defDen = Number(r.default_den);
        if(r.follow_up)   o.fu = r.follow_up;
        if(String(r.is_dqa)==='OUI')    o.dqa = 1;
        if(String(r.per_month)==='OUI') o.perMonth = true;
        if(items) o.items = items;
        /* ---- EVERYTHING BELOW USED TO BE LOST ON THE WAY BACK --------------------
           The phone rebuilt its questionnaire correctly at start-up and the very next
           pull replaced it with this object — which carried no subtitle, no gate, no
           carried denominator, no shared sample and no order. A per-month question came
           back without its flag, so its month stopped following the cycle and every DQA
           line read July. Nothing was wrong with the questionnaire; it was being undone
           twenty-five seconds after it was built. */
        if(r.subtitle)      o.sub = r.subtitle;
        if(String(r.gate)==='OUI' || r.gate===true) o.gate = true;
        if(r.den_from)      o.denFrom = String(r.den_from);
        if(r.sample_group)  o.sampleGroup = String(r.sample_group);
        if(String(r.no_child)==='OUI' || r.no_child===true) o.noChild = true;
        if(r.sort_order)    o.order = Number(r.sort_order);
        return o;
      }).filter(function(q){ return q.id && q.q; });

      out.sites = rowsOf('SITES').map(function(r){
        return {id:String(r.site_id), district:r.district, area:r.area, facility:r.facility,
                status:r.status||'ACTIVE', version:Number(r.version)||1};
      }).filter(function(s){ return s.id; });
    }
    return json(withReset(out));
  }
  /* FIND MY ACCOUNT.
     Without this, a new or wiped phone can only offer "S'enrôler", so the person enrols a
     second time and you get two records for one human being. That is where every duplicate
     has come from. Here they type the phone number they enrolled with and their existing
     account is installed on the device.
     What travels back: what the sign-in screen needs to show, and nothing else.
     NEVER the PIN, never the identity-document number, never another person's record —
     a number that matches nothing returns nothing, so this cannot be used to browse the
     roster. The PIN is still required to actually get in. */
  if(p.action === 'find'){
    var digits = String(p.phone||'').replace(/[^0-9]/g,'');
    if(digits.length < 8) return json({ok:true, found:[]});
    var tail = digits.slice(-9);
    var out = userRows().filter(function(u){
      if(String(u.role) === 'SUPER') return false;
      var ph = String(u.phone||'').replace(/[^0-9]/g,'');
      return ph.length >= 8 && ph.slice(-9) === tail;
    }).map(function(u){
      return {id:u.id, name:u.name, role:u.role, fn:u.fn, matricule:u.matricule,
              idType:u.idType, idLast:u.idLast, phone:u.phone, email:u.email,
              districts:u.districts, sites:u.sites, status:u.status, active:u.active,
              decisionNote:u.decisionNote, enrolled:u.enrolled};
    });
    return json(withReset({ok:true, found: out}));
  }

  /* Before a supervisor starts a visit, the phone asks whether this facility has
     already been submitted for this cycle by somebody else. Cheap, and it stops the
     duplicate at the only moment it can still be stopped for free. */
  if(p.action === 'taken'){
    /* A facility is CLAIMED the moment somebody opens it, not when they submit it.
       This used to count only submitted work, so two supervisors could each be holding
       an open draft of the same facility with nothing to tell either of them — the
       collision surfaced days later, as a double submission neither could undo. */
    var rows = claimedVisitRows(String(p.cycleId||''), String(p.siteId||''));
    return json({ok:true, taken:rows.length, by:rows.map(function(r){
      return {supervisor:String(r.supervisor||''), uid:String(r.supervisor_uid||''),
              date:fmtDate(r.visit_date), status:String(r.status||''),
              id:String(r.visit_id)};
    })});
  }
  if(p.action === 'ping') return json({ok:true, app:'ATHECS', version:SCRIPT_VERSION,
                                       appExpected: APP_EXPECTED,
                                       time:new Date().toISOString()});

  /* What the workbook actually holds, in numbers. This is the answer to "I submitted a
     supervision and I cannot see it": either the workbook has it and the phone did not
     receive it, or the workbook never received it and the supervisor's phone is still
     holding it in its outbox. Nobody should have to guess which. */
  if(p.action === 'diag'){
    var vs = rowsOf('VISITS');
    var by = {};
    vs.forEach(function(r){ var st=String(r.status||'?'); by[st]=(by[st]||0)+1; });
    var us = rowsOf('USERS');
    var byRole = {};
    us.forEach(function(r){ var k=String(r.role||'?')+'/'+String(r.status||'?');
                            byRole[k]=(byRole[k]||0)+1; });
    var cy = rowsOf('CYCLES').map(reviveCycle).filter(Boolean);
    var open = cy.filter(function(c){ return c.status==='OPEN'; })[0];
    return json({ok:true, version:SCRIPT_VERSION, now:new Date().getTime(),
      sheetId: SHEET_ID,
      visits: vs.length, visitsByStatus: by,
      answers: rowsOf('ANSWERS').length,
      actions: rowsOf('ACTIONS').length,
      users: us.length, usersByRole: byRole,
      sites: rowsOf('SITES').length,
      questions: rowsOf('QUESTIONS').length,
      cycles: cy.length,
      openCycle: open ? {name:open.name, months:open.months.length,
                         ticked:(open.monthsComplete||[]).filter(Boolean).length} : null,
      /* the last few supervisions, so a name can be recognised at a glance */
      recent: vs.slice(-8).map(function(r){ return {
        id:String(r.visit_id), facility:String(r.facility||''), district:String(r.district||''),
        supervisor:String(r.supervisor||''), status:String(r.status||''),
        date:fmtDate(r.visit_date), submitted:tms(r.submitted_at) }; })
    });
  }
  return json({ok:true, app:'ATHECS — Integrated Supervision West Region'});
}
/** Attached to every read: a phone compares these with what it has already applied. */
/** ONE PERSON, ONE ACCOUNT.
 *  The surviving id is the one the existing supervisions already point at. Everything the
 *  dropped record holds and the survivor lacks is copied over, every row that referred to
 *  the dropped id is re-pointed, the dropped record is archived in full, and the mapping is
 *  published so the phone still holding it swaps silently. Nothing is destroyed. */
function mergeAccounts(p){
  var keepId = String(p.keepId||''), dropId = String(p.dropId||'');
  if(!keepId || !dropId || keepId === dropId) return {ok:false, error:'bad ids'};

  var sh = sheet('USERS'), map = headerMap(sh), last = sh.getLastRow(), width = sh.getLastColumn();
  if(last < 2) return {ok:false, error:'no users'};
  var rows = sh.getRange(2,1,last-1,width).getValues();
  var ki = map['user_id'];
  var keepRow = -1, dropRow = -1;
  for(var i=0;i<rows.length;i++){
    if(String(rows[i][ki]) === keepId) keepRow = i;
    if(String(rows[i][ki]) === dropId) dropRow = i;
  }
  if(keepRow < 0) return {ok:false, error:'kept account not found'};

  /* 1 · fill the survivor's blanks from the dropped record */
  if(dropRow >= 0){
    Object.keys(map).forEach(function(h){
      if(h === 'user_id' || h === 'status' || h === 'active') return;
      var c = map[h];
      var cur = rows[keepRow][c], other = rows[dropRow][c];
      if((cur === '' || cur === null) && other !== '' && other !== null) rows[keepRow][c] = other;
    });
    sh.getRange(keepRow+2, 1, 1, width).setValues([rows[keepRow]]);
  }

  /* 2 · re-point every row that named the dropped account */
  var moved = 0;
  moved += repoint('VISITS',        'supervisor_uid', dropId, keepId);
  moved += repoint('SITE_REQUESTS', 'requester_uid',  dropId, keepId);
  moved += repoint('MESSAGES',      'author_uid',     dropId, keepId);
  moved += repoint('AUDIT',         'user_id',        dropId, keepId);
  /* the visit's raw copy carries the uid too */
  moved += repointRaw('VISITS', dropId, keepId);

  /* 3 · archive the dropped record in full, then remove it from USERS */
  if(dropRow >= 0){
    var obj = {}; Object.keys(map).forEach(function(h){ obj[h] = rows[dropRow][map[h]]; });
    upsert('ARCHIVE','archived_id',dropId,{
      archived_id:dropId, became_id:keepId, name:obj['name']||'', role:obj['role']||'',
      archived_by:String(p.by||''), archived_at:new Date(),
      reason:String(p.reason||'compte en double'), raw:JSON.stringify(obj)});
    sh.deleteRow(dropRow+2);
  }
  upsert('MERGES','drop_id',dropId,{drop_id:dropId, keep_id:keepId,
    merged_by:String(p.by||''), merged_at:new Date()});
  return {ok:true, moved:moved, keepId:keepId, dropId:dropId};
}
function repoint(tab, col, from, to){
  var sh = sheet(tab), map = headerMap(sh), last = sh.getLastRow();
  if(last < 2 || map[col] === undefined) return 0;
  var c = map[col] + 1;
  var vals = sh.getRange(2, c, last-1, 1).getValues();
  var n = 0;
  for(var i=0;i<vals.length;i++) if(String(vals[i][0]) === from){ vals[i][0] = to; n++; }
  if(n) sh.getRange(2, c, last-1, 1).setValues(vals);
  return n;
}
function repointRaw(tab, from, to){
  var sh = sheet(tab), map = headerMap(sh), last = sh.getLastRow();
  if(last < 2 || map['raw'] === undefined) return 0;
  var c = map['raw'] + 1;
  var vals = sh.getRange(2, c, last-1, 1).getValues();
  var n = 0;
  for(var i=0;i<vals.length;i++){
    var t = String(vals[i][0]||''); if(!t) continue;
    try{
      var o = JSON.parse(t);
      if(String(o.uid) === from){ o.uid = to; vals[i][0] = JSON.stringify(o); n++; }
    }catch(e){}
  }
  if(n) sh.getRange(2, c, last-1, 1).setValues(vals);
  return n;
}

/* ---------------------------------------------------------------------------
   ASSIGN · CLAIM · RELEASE
   A slot moves between three states and the server owns every transition:
     unassigned            no name, invisible, nobody can sign in
     assigned, unclaimed   name shown "à activer", accepts ONLY the claim code
     claimed               accepts only the PIN that person chose on their phone
   Reassigning clears claimed_at, which is what makes the previous holder's
   phone let go of the account by itself at its next connection. */
function sixDigits(){ return String(Math.floor(100000 + Math.random()*900000)); }

function assignSlot(p){
  var id = String(p.slotId||'');
  var slot = ADMIN_SLOTS.concat(SUPER_SLOTS).filter(function(x){ return x.id===id; })[0];
  if(!slot) return {ok:false, error:'unknown slot'};
  /* Only an administrator may assign, and only a SUPER slot. An ADMIN slot is
     claimed from this editor alone — see nouveauCodeAdmin(). */
  if(id.charAt(0) === 'A') return {ok:false, error:'an admin slot is claimed from the Apps Script editor'};
  var by = userRow(String(p.byId||''));
  if(!by || String(by['role']) !== 'ADMIN') return {ok:false, error:'only an administrator can assign'};

  var code = sixDigits();
  upsert('USERS','user_id',id,{
    user_id:id, name:String(p.name||'').trim(), role:'SUPER',
    phone:String(p.phone||'').trim(), districts:'ALL',
    status:'ACTIVE', active:true,
    claim_code:code, claim_code_at:new Date(), claimed_at:'',
    assigned_by:String(by['name']||''), assigned_at:new Date(), updated_at:new Date()});
  return {ok:true, code:code, slotId:id};
}

function releaseSlot(p){
  var id = String(p.slotId||'');
  var by = userRow(String(p.byId||''));
  if(!by || String(by['role']) !== 'ADMIN') return {ok:false, error:'only an administrator can release'};
  if(id.charAt(0) === 'A') return {ok:false, error:'an admin slot cannot be released from the app'};
  upsert('USERS','user_id',id,{
    user_id:id, name:'', role:'SUPER', phone:'', districts:'ALL',
    status:'ACTIVE', active:true,
    claim_code:'', claim_code_at:'', claimed_at:'',
    assigned_by:String(by['name']||''), assigned_at:new Date(), updated_at:new Date()});
  return {ok:true};
}

/** The ONE place a claim code is tested. Compared here, never returned, burned on use. */
function claimSlot(p){
  var lk = LockService.getScriptLock();
  try{
    lk.waitLock(15000);
    var id = String(p.slotId||'');
    var sh = sheet('USERS'), map = headerMap(sh), last = sh.getLastRow();
    if(last < 2) return {ok:true, valid:false};
    var ids = sh.getRange(2, map['user_id']+1, last-1, 1).getValues();
    for(var i=0;i<ids.length;i++){
      if(String(ids[i][0]) !== id) continue;
      var row = i+2;
      var code = String(sh.getRange(row, map['claim_code']+1).getValue()||'');
      var at   = sh.getRange(row, map['claim_code_at']+1).getValue();
      var age  = at ? (new Date().getTime() - new Date(at).getTime()) : Infinity;
      if(!code || code !== String(p.code||'') || age > CLAIM_TTL) return {ok:true, valid:false};
      sh.getRange(row, map['claim_code']+1).setValue('');
      sh.getRange(row, map['claim_code_at']+1).setValue('');
      sh.getRange(row, map['claimed_at']+1).setValue(new Date());
      return {ok:true, valid:true,
              name: sh.getRange(row, map['name']+1).getValue(),
              role: sh.getRange(row, map['role']+1).getValue(),
              phone: sh.getRange(row, map['phone']+1).getValue()};
    }
    return {ok:true, valid:false};
  }catch(err){ return {ok:false, error:String(err)}; }
  finally{ try{ lk.releaseLock(); }catch(x){} }
}

/** RUN THIS FROM THE EDITOR to hand an administrator slot to somebody.
 *  It is deliberately not reachable from the app: whoever owns this workbook
 *  decides who administers the region, and nobody else can.
 *      nouveauCodeAdmin('A001', 'Che Frankline ANYIANG', '+237690000001')  */
function nouveauCodeAdmin(slotId, name, phone){
  slotId = slotId || 'A001';
  if(slotId.charAt(0) !== 'A') return 'ERREUR : un slot administrateur commence par A (A001 ou A002).';
  var cur = userRow(slotId) || {};
  /* A slot with no name is invisible in the app: the Administration screen lists only
     slots that have been given to a named person. Running this from the toolbar button
     passes no arguments at all, so without this check the code would be issued for a
     nameless slot and nobody could ever use it. Say so instead. */
  var finalName = String(name || cur['name'] || '').trim();
  if(!finalName) return 'ERREUR : aucun nom.\n\n'
    + 'Le bouton « Exécuter » n\'envoie aucun argument à la fonction.\n'
    + 'Écrivez votre nom tout en haut de ce fichier, dans MON_NOM,\n'
    + 'enregistrez, puis exécutez la fonction  activerAdmin  (et non nouveauCodeAdmin).';
  var code = sixDigits();
  upsert('USERS','user_id',slotId,{
    user_id:slotId, name:finalName, role:'ADMIN',
    phone:String(phone || cur['phone'] || '').trim(), districts:'ALL',
    status:'ACTIVE', active:true,
    claim_code:code, claim_code_at:new Date(), claimed_at:'',
    assigned_by:'éditeur Apps Script', assigned_at:new Date(), updated_at:new Date()});
  return 'CODE POUR ' + slotId + ' (' + finalName + ') : ' + code
       + '\n\nValable 24 heures, usage unique.'
       + '\nLa personne ouvre l\'application ▸ Administration ▸ choisit son nom ▸ saisit ce code'
       + '\n▸ puis choisit son propre code PIN.';
}

/* ------------------------------------------------- readers for the data endpoint */
/** Every row of a tab as an object keyed by HEADER NAME — the same discipline as upsert().
 *  A reordered or newly appended column can never shift a value into the wrong field. */
function rowsOf(name){
  var sh = sheet(name), last = sh.getLastRow(), width = sh.getLastColumn();
  if(last < 2) return [];
  var head = sh.getRange(1,1,1,width).getValues()[0].map(function(h){ return String(h).trim(); });
  return sh.getRange(2,1,last-1,width).getValues().map(function(r){
    var o = {}; head.forEach(function(h,i){ if(h) o[h] = r[i]; }); return o;
  });
}
function tms(v){
  if(v === '' || v === null || v === undefined) return 0;
  if(v instanceof Date) return v.getTime();
  var n = Number(v); if(!isNaN(n) && n > 1e11) return n;
  var d = new Date(v); var t = d.getTime();
  return isNaN(t) ? 0 : t;
}
function fmtDate(v){
  if(!v) return '';
  if(v instanceof Date) return Utilities.formatDate(v, 'Etc/GMT', 'yyyy-MM-dd');
  return String(v);
}
/** Rebuild the supervision object the app works with. `raw` carries it exactly;
 *  the named columns are the fallback for a row written before raw existed. */
function reviveVisit(r){
  var v = null;
  try{ v = JSON.parse(r.raw || 'null'); }catch(e){}
  if(!v || !v.id){
    var mc = []; try{ mc = JSON.parse(r.months_complete||'[]'); }catch(e){}
    v = { id:String(r.visit_id), cycleId:String(r.cycle_id), siteId:String(r.site_id),
          supervisor:r.supervisor, uid:String(r.supervisor_uid||''), date:fmtDate(r.visit_date),
          team:r.team||'', status:r.status||'DRAFT', monthsComplete:mc,
          reviewedBy:r.reviewed_by||'', reviewNote:r.review_note||'' };
  }
  v.submitted  = tms(r.submitted_at) || v.submitted || 0;
  v.reviewedAt = tms(r.reviewed_at)  || v.reviewedAt || 0;
  v.updated    = tms(r.updated_at)   || v.submitted || 0;
  /* The conflict flag lives in the sheet, never in raw: it is the SERVER's finding
     about this visit and the others beside it, so it always overrides what the phone
     last uploaded — including clearing it once the supervisor has resolved it. */
  v.conflict = String(r.conflict||'').split(',').map(function(x){ return x.trim(); }).filter(Boolean);
  return v;
}
/** The cycle as the app holds it. `raw` is exact; the readable columns are the fallback
 *  for a row written before raw existed ("7/2026, 8/2026" and "true, true, false"). */
function reviveCycle(r){
  var c = null;
  try{ c = JSON.parse(r.raw || 'null'); }catch(e){}
  if(c && c.id && (c.months||[]).length) return c;
  var mo = String(r.months||'').split(',').map(function(t){
    var p = t.trim().split('/'); if(p.length!==2) return null;
    var m = Number(p[0])-1, y = Number(p[1]);
    return (isNaN(m)||isNaN(y)) ? null : {m:m, y:y};
  }).filter(Boolean);
  var mc = String(r.months_complete||'').split(',').map(function(t){
    return String(t).trim().toLowerCase() !== 'false';
  });
  while(mc.length < mo.length) mc.push(true);
  return {id:String(r.cycle_id), name:r.name, fy:Number(r.fy), q:Number(r.quarter),
          months:mo, monthsComplete:mc.slice(0,mo.length),
          open:fmtDate(r.open), close:fmtDate(r.close),
          deadline:fmtDate(r.deadline), status:r.status||'PLANNED'};
}

/** Last-resort reconstruction from the human-readable columns. Lossy by design:
 *  it cannot recover a follow-up answer, a delay or a checklist. */
function flatAnswer(r){
  var a = {};
  if(String(r.na) === 'OUI'){ a.na = true; a.naReason = r.na_reason || ''; }
  else {
    if(r.numerator   !== '' && r.numerator   !== null) a.num = r.numerator;
    if(r.denominator !== '' && r.denominator !== null) a.den = r.denominator;
  }
  if(r.comment) a.comment = r.comment;
  return a;
}

function withReset(o){
  o.resetAt      = Number(getSetting('reset_data_at')  || 0) || 0;
  o.resetUsersAt = Number(getSetting('reset_users_at') || 0) || 0;
  return o;
}
function json(o){
  return ContentService.createTextOutput(JSON.stringify(o))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ------------------------------------------------------------------ writers */
/** Read one USERS row as an object addressed by header name (or null). */
function userRow(uid){
  var sh = sheet('USERS'), map = headerMap(sh), last = sh.getLastRow();
  if(last < 2 || map['user_id'] === undefined) return null;
  var ids = sh.getRange(2, map['user_id']+1, last-1, 1).getValues();
  for(var i=0;i<ids.length;i++){
    if(String(ids[i][0]) !== String(uid)) continue;
    var r = sh.getRange(i+2, 1, 1, sh.getLastColumn()).getValues()[0];
    var o = {}; Object.keys(map).forEach(function(k){ o[k] = r[map[k]]; });
    return o;
  }
  return null;
}

function saveUser(u){
  /* A phone posts its enrolment with status PENDING and keeps retrying until the server
     confirms. If that retry lands after central has already decided, it must not undo the
     decision — the decision belongs to the server, not to the phone. */
  var cur = userRow(u.id);
  var st  = u.status || 'PENDING';

  /* The roster (?action=users) deliberately never returns the identity document, the
     matricule, the device or the enrolment date. A console that learned about somebody
     through the roster therefore holds a record without them — and pushing that record back
     (on approval, on a transfer) used to blank those cells. Anything the API cannot return
     is kept as it stands unless the push actually carries a value. */
  var keepIfBlank = {
    id_type:    u.idType    || '', id_number: u.idNumber || '',
    matricule:  u.matricule || '', device:    u.device   || ''
  };
  /* ---- THE SLOT COLUMNS ARE NOT THE PHONE'S TO WRITE -------------------------------
     upsert() rebuilds the WHOLE row from the object it is given, so any column the
     object does not mention is blanked. This function never mentioned claim_code,
     claim_code_at, claimed_at, assigned_by or assigned_at — so every ordinary push of
     a privileged account erased them, and above all erased claimed_at.

     What that did in the field: an administrator activated with their 6-digit code,
     chose a PIN, and the app pushed the account like any other. That push blanked
     claimed_at. Twenty-five seconds later the phone asked the server about its slots,
     was told the slot was no longer claimed, wiped the PIN it had just been given and
     signed the person out — needing a brand-new code from the editor. Every single time.

     These five cells belong to assign / claim / release alone. Carry them through. */
  var slotCols = ['claim_code','claim_code_at','claimed_at','assigned_by','assigned_at',
                  'dual','req_role','req_scope','req_fn','req_at','req_status','req_note','req_by'];
  var keepSlot = {};
  if(cur) slotCols.forEach(function(k){ if(cur[k] !== undefined) keepSlot[k] = cur[k]; });

  /* ---- A PHONE MAY NOT GRANT ITSELF SCOPE ------------------------------------------
     This function wrote role, districts and sites straight from whatever arrived. The
     status was protected — an already-decided account could not be pushed back to
     PENDING — but the SCOPE was not. An enrolment push carrying role:'SUPERVISOR' and
     every district in the region would simply have been accepted.

     Once an account is settled, its role and its scope are the server's to change, and
     only through an approval (roleSet). An ordinary push may still correct the person's
     own details — name, function, telephone, email — and nothing else.

     This is not absolute: the link password is shared with every phone by design, so a
     determined person holding it can still forge a privileged message. What it does is
     close the ordinary path, make every grant an explicit and journalled act, and stop
     an accident or a curious user from becoming a supervisor of the whole region. */
  var settledNow = cur && ['ACTIVE','SUSPENDED','REJECTED']
        .indexOf(String(cur['status']||'').trim().toUpperCase()) >= 0;
  var lockedRole      = settledNow ? cur['role']      : (u.role || 'SUPERVISOR');
  var lockedDistricts = settledNow ? cur['districts'] : (Array.isArray(u.districts)? u.districts.join(', ') : String(u.districts||''));
  var lockedSites     = settledNow ? cur['sites']     : (Array.isArray(u.sites)? u.sites.join(', ') : String(u.siteId||''));
  if(cur) Object.keys(keepIfBlank).forEach(function(k){
    if(!keepIfBlank[k] && cur[k]) keepIfBlank[k] = cur[k];
  });
  var enrolledAt = u.enrolled ? new Date(u.enrolled)
                 : (cur && cur['enrolled_at'] ? cur['enrolled_at'] : new Date());
  var settled = ['ACTIVE','SUSPENDED','REJECTED'];
  var keep = cur && settled.indexOf(String(cur['status']||'').trim().toUpperCase()) >= 0;
  if(keep && String(st).toUpperCase() === 'PENDING'){
    st = String(cur['status']).trim().toUpperCase();
    u = Object.assign({}, u, {
      approvedBy:   u.approvedBy   || cur['approved_by'],
      decisionNote: u.decisionNote || cur['decision_note'],
      active:       cur['active'] !== false && String(cur['active']).toLowerCase() !== 'false'
    });
  }
  upsert('USERS','user_id',u.id,{
    user_id:u.id, name:u.name, role:lockedRole, 'function':u.fn||'', matricule:keepIfBlank.matricule,
    id_type:keepIfBlank.id_type, id_number:keepIfBlank.id_number,
    phone:u.phone||'', email:u.email||'',
    districts: lockedDistricts,
    sites: lockedSites,
    status: st,
    active: u.active !== false,
    pin_reset_code: u.pinResetCode || '',
    pin_reset_at: u.pinResetAt ? new Date(u.pinResetAt) : '',
    pin_help_at: u.pinHelp ? new Date(u.pinHelp) : '',
    approved_by: u.approvedBy || '', approved_at: u.approvedAt ? new Date(u.approvedAt) : '',
    decision_note: u.decisionNote || '', device: keepIfBlank.device,
    enrolled_at: enrolledAt, updated_at: new Date(),
    claim_code:    keepSlot['claim_code']    !== undefined ? keepSlot['claim_code']    : '',
    claim_code_at: keepSlot['claim_code_at'] !== undefined ? keepSlot['claim_code_at'] : '',
    claimed_at:    keepSlot['claimed_at']    !== undefined ? keepSlot['claimed_at']    : '',
    assigned_by:   keepSlot['assigned_by']   !== undefined ? keepSlot['assigned_by']   : '',
    assigned_at:   keepSlot['assigned_at']   !== undefined ? keepSlot['assigned_at']   : '',
    dual:          keepSlot['dual']          !== undefined ? keepSlot['dual']          : '',
    req_role:      keepSlot['req_role']      !== undefined ? keepSlot['req_role']      : '',
    req_scope:     keepSlot['req_scope']     !== undefined ? keepSlot['req_scope']     : '',
    req_fn:        keepSlot['req_fn']        !== undefined ? keepSlot['req_fn']        : '',
    req_at:        keepSlot['req_at']        !== undefined ? keepSlot['req_at']        : '',
    req_status:    keepSlot['req_status']    !== undefined ? keepSlot['req_status']    : '',
    req_note:      keepSlot['req_note']      !== undefined ? keepSlot['req_note']      : '',
    req_by:        keepSlot['req_by']        !== undefined ? keepSlot['req_by']        : ''
  });
  if(u.idFile) saveFile(u.idFile, 'ID_'+u.name+'_'+u.id);
}

/* =====================================================================
   A SECOND HAT IS REQUESTED HERE, AND GRANTED SOMEWHERE ELSE

   roleRequest() is what a phone may send. It writes into the req_* cells and
   NOTHING else: it cannot touch role, districts, sites or dual. The worst a
   forged request can do is put a line in front of a super user, who will look
   at it and refuse it.

   roleGrant() is the approval. It is the only thing that sets `dual` and the
   second scope, it requires a privileged caller, and it clears the request.
   ===================================================================== */
function narrowWrite(userId, cells){
  var sh = sheet('USERS'), map = headerMap(sh), last = sh.getLastRow();
  if(last < 2) return false;
  var ids = sh.getRange(2, map['user_id']+1, last-1, 1).getValues();
  for(var i=0;i<ids.length;i++){
    if(String(ids[i][0]) !== String(userId)) continue;
    var row = i+2, wrote = false;
    Object.keys(cells).forEach(function(c){
      if(map[c] === undefined) return;
      sh.getRange(row, map[c]+1).setValue(cells[c]); wrote = true;
    });
    if(map['updated_at'] !== undefined) sh.getRange(row, map['updated_at']+1).setValue(new Date());
    return wrote;
  }
  return false;
}
/** From a phone. Records a wish. Grants nothing. */
function roleRequest(p){
  var id = String(p.id||'');
  var cur = userRow(id);
  if(!cur) return {ok:false, error:'unknown account'};
  if(String(cur['status']||'').trim().toUpperCase() !== 'ACTIVE')
    return {ok:false, error:'an account must be approved before it can ask for a second role'};
  var want = String(p.want||'').toUpperCase();
  if(want !== 'SUPERVISOR' && want !== 'SITE') return {ok:false, error:'unknown role'};
  /* asking for the hat you already wear is not a request, it is a no-op */
  var isDualNow = String(cur['dual']||'').toLowerCase() === 'true';
  if(isDualNow) return {ok:false, error:'this account already carries both roles'};
  if(want === String(cur['role']||'').toUpperCase())
    return {ok:false, error:'this account already has that role'};
  var scope = Array.isArray(p.scope) ? p.scope.join(', ') : String(p.scope||'');
  if(!scope.trim()) return {ok:false, error:'no district or facility given'};
  narrowWrite(id, {
    req_role: want, req_scope: scope, req_fn: String(p.fn||''),
    req_at: new Date(), req_status: 'PENDING', req_note: '', req_by: ''});
  return {ok:true};
}
/** The approval. Only a privileged account may call it, and it is journalled. */
function roleGrant(p){
  var id = String(p.id||'');
  var by = userRow(String(p.byId||''));
  if(!by || ['SUPER','ADMIN'].indexOf(String(by['role']||'').toUpperCase()) < 0)
    return {ok:false, error:'only a super user or an administrator can grant a role'};
  var cur = userRow(id);
  if(!cur) return {ok:false, error:'unknown account'};

  if(p.refuse){
    narrowWrite(id, {req_status:'REFUSED', req_note:String(p.note||''), req_by:String(by['name']||'')});
    return {ok:true, refused:true};
  }
  var want = String(p.want||cur['req_role']||'').toUpperCase();
  if(want !== 'SUPERVISOR' && want !== 'SITE') return {ok:false, error:'unknown role'};
  var scope = Array.isArray(p.scope) ? p.scope.join(', ')
            : String(p.scope || cur['req_scope'] || '');
  if(!scope.trim()) return {ok:false, error:'no district or facility given'};

  var cells = {dual:true, req_role:'', req_scope:'', req_fn:'', req_at:'',
               req_status:'GRANTED', req_note:'', req_by:String(by['name']||'')};
  /* the hat being ADDED fills its own column; the column of the hat they already
     wear is never touched, so one can never quietly overwrite the other */
  if(want === 'SUPERVISOR') cells['districts'] = scope;
  else                      cells['sites']     = scope;
  narrowWrite(id, cells);
  return {ok:true, granted:want};
}
/* ---------------------------------------------------------------------
   MOVING SOMEBODY, ON PURPOSE

   saveUser() locks role, districts and sites the moment an account is
   settled, so that a phone cannot hand itself the whole region. That lock
   was right and it stays — but it also refused the one caller who is
   ENTITLED to move somebody: the console. An administrator changed a
   supervisor's districts, the change was saved on the phone, the push was
   ignored by the server, and the next pull put the old districts back. The
   administrator saw their own work undone and had no way to tell why.

   A transfer is a privileged act, so it travels like one — its own message,
   its own check on the caller, its own narrow write. Exactly the shape of
   roleGrant, for an account that carries a single hat.
   --------------------------------------------------------------------- */
function scopeSet(p){
  var id = String(p.id||'');
  var by = userRow(String(p.byId||''));
  if(!by || ['SUPER','ADMIN'].indexOf(String(by['role']||'').toUpperCase()) < 0)
    return {ok:false, error:'only a super user or an administrator can change an assignment'};
  var cur = userRow(id);
  if(!cur) return {ok:false, error:'unknown account'};
  if(String(cur['dual']||'').toLowerCase() === 'true')
    return {ok:false, error:'this account carries two roles — use roleGrant, which writes one hat without touching the other'};

  var what = String(p.what||'').toUpperCase();          // DISTRICTS | SITES | ROLE
  var cells = {};
  if(what === 'DISTRICTS'){
    var ds = Array.isArray(p.scope) ? p.scope.join(', ') : String(p.scope||'');
    if(!ds.trim()) return {ok:false, error:'a supervisor with no district sees nothing — give at least one'};
    cells['districts'] = ds;
  } else if(what === 'SITES'){
    var ss = Array.isArray(p.scope) ? p.scope.join(', ') : String(p.scope||'');
    if(!ss.trim()) return {ok:false, error:'give at least one facility'};
    cells['sites'] = ss;
    /* For a single-hat facility account the districts have always been derived
       from the facilities. Keep that, or the person drops out of every list. */
    if(p.districts !== undefined)
      cells['districts'] = Array.isArray(p.districts) ? p.districts.join(', ') : String(p.districts||'');
  } else if(what === 'ROLE'){
    var r = String(p.role||'').toUpperCase();
    if(['SUPERVISOR','SITE','VIEWER'].indexOf(r) < 0)
      return {ok:false, error:'a privileged role is never given here — it is a slot, assigned by code'};
    cells['role'] = r;
  } else {
    return {ok:false, error:'say what is being changed: DISTRICTS, SITES or ROLE'};
  }
  narrowWrite(id, cells);
  return {ok:true, set:what};
}

/* =====================================================================
   THE PEN ON A SUPERVISION

   One phone writes a facility; the others read it. The holder is
   supervisor_uid, and it is changed HERE rather than by a phone pushing a
   visit with a different name on it — otherwise two phones could each
   declare themselves the holder and the last one to sync would win.

   Who may move it: the holder, or a super user, or an administrator. That
   third case is the whole point — the holder is the person who is ill.
   ===================================================================== */
function visitRow_(id){
  var sh=sheet('VISITS'), map=headerMap(sh), last=sh.getLastRow();
  if(last<2) return null;
  var ids=sh.getRange(2, map['visit_id']+1, last-1, 1).getValues();
  for(var i=0;i<ids.length;i++) if(String(ids[i][0])===String(id))
    return {row:i+2, sh:sh, map:map};
  return null;
}
function penSet(p){
  var loc=visitRow_(String(p.visitId||''));
  if(!loc) return {ok:false, error:'unknown supervision'};
  var by=userRow(String(p.byId||''));
  if(!by) return {ok:false, error:'unknown caller'};
  var cur=loc.sh.getRange(loc.row, loc.map['supervisor_uid']+1).getValue();
  var privileged = ['SUPER','ADMIN'].indexOf(String(by['role']||'').toUpperCase()) >= 0;
  if(!privileged && String(cur) !== String(p.byId))
    return {ok:false, error:'only the holder, a super user or an administrator can transfer this supervision'};
  var st=String(loc.sh.getRange(loc.row, loc.map['status']+1).getValue()||'').toUpperCase();
  if(st==='SUBMITTED' || st==='APPROVED')
    return {ok:false, error:'a submitted supervision has no pen to hand over — reopen it first'};

  var to=userRow(String(p.toId||''));
  if(!to) return {ok:false, error:'unknown recipient'};
  if(String(to['status']||'').trim().toUpperCase() !== 'ACTIVE')
    return {ok:false, error:'the recipient account is not active'};

  loc.sh.getRange(loc.row, loc.map['supervisor_uid']+1).setValue(String(p.toId));
  loc.sh.getRange(loc.row, loc.map['supervisor']+1).setValue(String(p.toName||to['name']||''));
  /* raw is what the phones actually read back, so the holder has to change INSIDE it
     too — a row that disagrees with its own raw is a bug waiting for a quiet evening. */
  var rawCell = loc.map['raw'];
  if(rawCell !== undefined){
    var raw = loc.sh.getRange(loc.row, rawCell+1).getValue();
    try{
      var v = JSON.parse(raw||'null');
      if(v){ v.uid=String(p.toId); v.supervisor=String(p.toName||to['name']||''); v.penReq=null;
             v.updated=new Date().getTime();
             loc.sh.getRange(loc.row, rawCell+1).setValue(JSON.stringify(v)); }
    }catch(e){}
  }
  /* bump updated_at or the change never reaches a single phone */
  loc.sh.getRange(loc.row, loc.map['updated_at']+1).setValue(new Date());
  saveAudit({id:'PEN-'+new Date().getTime()+'-'+Math.floor(Math.random()*9999),
             ts:new Date().getTime(), user:String(by['name']||''), uid:String(p.byId||''),
             action:'PEN_TRANSFER', entity:'visit',
             detail:String(p.visitId)+' → '+String(p.toName||to['name']||'')+' ('+String(p.why||'')+')'});
  return {ok:true, holder:String(p.toId)};
}
/** A request is a note in the margin. It grants nothing; somebody still has to act. */
function penReq(p){
  var loc=visitRow_(String(p.visitId||''));
  if(!loc) return {ok:false, error:'unknown supervision'};
  var rawCell=loc.map['raw']; if(rawCell===undefined) return {ok:false, error:'no raw column'};
  var raw=loc.sh.getRange(loc.row, rawCell+1).getValue();
  var v=null; try{ v=JSON.parse(raw||'null'); }catch(e){}
  if(!v) return {ok:false, error:'this supervision has never been uploaded'};
  v.penReq={byId:String(p.byId||''), byName:String(p.byName||''), why:String(p.why||''),
            at:new Date().getTime(), status:'PENDING'};
  v.updated=new Date().getTime();
  loc.sh.getRange(loc.row, rawCell+1).setValue(JSON.stringify(v));
  loc.sh.getRange(loc.row, loc.map['updated_at']+1).setValue(new Date());
  saveAudit({id:'PENQ-'+new Date().getTime()+'-'+Math.floor(Math.random()*9999),
             ts:new Date().getTime(), user:String(p.byName||''), uid:String(p.byId||''),
             action:'PEN_REQUEST', entity:'visit',
             detail:String(p.visitId)+' — '+String(p.why||'')});
  return {ok:true};
}

/** Taking a hat away. Explicit, because an absence never travels by itself. */
function roleRevoke(p){
  var id = String(p.id||'');
  var by = userRow(String(p.byId||''));
  if(!by || ['SUPER','ADMIN'].indexOf(String(by['role']||'').toUpperCase()) < 0)
    return {ok:false, error:'only a super user or an administrator can revoke a role'};
  var cur = userRow(id);
  if(!cur) return {ok:false, error:'unknown account'};
  if(String(cur['dual']||'').toLowerCase() !== 'true')
    return {ok:false, error:'this account carries only one role'};
  var drop = String(p.drop||'').toUpperCase();          // the hat being removed
  if(drop !== 'SUPERVISOR' && drop !== 'SITE') return {ok:false, error:'unknown role'};
  if(drop === String(cur['role']||'').toUpperCase())
    return {ok:false, error:'the primary role cannot be removed — deactivate the account instead'};
  var cells = {dual:false, req_status:'', req_role:'', req_scope:'', req_fn:'', req_at:''};
  if(drop === 'SUPERVISOR') cells['districts'] = '';
  else                      cells['sites']     = '';
  narrowWrite(id, cells);
  return {ok:true, revoked:drop};
}

/** Narrow write: touches ONLY the PIN-recovery cells of one user.
 *  A phone that reports a forgotten PIN, or finishes a reset, must never be able to
 *  rewrite its own status, districts or role by pushing a whole stale record. */
function setUserFlags(p){
  var sh = sheet('USERS'), map = headerMap(sh), last = sh.getLastRow();
  if(last < 2) return;
  var ids = sh.getRange(2, map['user_id']+1, last-1, 1).getValues();
  for(var i=0;i<ids.length;i++){
    if(String(ids[i][0]) !== String(p.id||'')) continue;
    var row = i+2;
    if(p.pinResetCode !== undefined) sh.getRange(row, map['pin_reset_code']+1).setValue(p.pinResetCode||'');
    if(p.pinResetAt   !== undefined) sh.getRange(row, map['pin_reset_at']+1).setValue(p.pinResetAt? new Date(p.pinResetAt):'');
    if(p.pinHelp      !== undefined) sh.getRange(row, map['pin_help_at']+1).setValue(p.pinHelp? new Date(p.pinHelp):'');
    sh.getRange(row, map['updated_at']+1).setValue(new Date());
    return;
  }
}

/* ---- user lifecycle reads -------------------------------------------------
   Deliberately narrow. PINs are never returned. Identity-document numbers are
   never returned either — central verifies those in the USERS tab of the
   workbook, which is private. Only the control fields a device needs. */
function userRows(){
  var sh = sheet('USERS'), last = sh.getLastRow();
  if(last < 2) return [];
  var map = headerMap(sh);
  var rows = sh.getRange(2,1,last-1,sh.getLastColumn()).getValues();
  return rows.map(function(r){
    return {
      id: r[map['user_id']], name: r[map['name']], role: r[map['role']],
      fn: r[map['function']], phone: r[map['phone']], email: r[map['email']],
      matricule: r[map['matricule']],
      idType: r[map['id_type']],
      /* only the last four characters travel — enough for the approver to check the
         document over the phone, never enough to reconstruct it. The full number
         stays in the private workbook. */
      idLast: String(r[map['id_number']]||'').slice(-4),
      districts: String(r[map['districts']]||'').split(',').map(function(x){return x.trim();}).filter(String),
      sites: String(r[map['sites']]||'').split(',').map(function(x){return x.trim();}).filter(String),
      status: r[map['status']] || 'PENDING',
      claimed: map['claimed_at'] !== undefined ? !!r[map['claimed_at']] : true,
      active: r[map['active']] !== false && String(r[map['active']]).toLowerCase() !== 'false',
      /* the temporary code itself is NEVER returned by any endpoint — only the fact
         that one is outstanding, and the fact that the person reported a loss. */
      pinResetAt: r[map['pin_reset_at']] ? new Date(r[map['pin_reset_at']]).getTime() : null,
      pinPending: !!String(r[map['pin_reset_code']]||''),
      pinHelp: r[map['pin_help_at']] ? new Date(r[map['pin_help_at']]).getTime() : null,
      approvedBy: r[map['approved_by']], decisionNote: r[map['decision_note']],
      enrolled: r[map['enrolled_at']] ? new Date(r[map['enrolled_at']]).getTime() : null,
      /* the second hat, and any request for one. `dual` travels as a real boolean so
         that TAKING a hat away reaches the phones: an absence never travels by itself. */
      dual: map['dual'] !== undefined
            && String(r[map['dual']]).toLowerCase() === 'true',
      req: (map['req_status'] !== undefined && String(r[map['req_status']]||'')) ? {
             role:   String(r[map['req_role']]||''),
             scope:  String(r[map['req_scope']]||'').split(',').map(function(x){return x.trim();}).filter(String),
             fn:     String(r[map['req_fn']]||''),
             at:     r[map['req_at']] ? new Date(r[map['req_at']]).getTime() : null,
             status: String(r[map['req_status']]||''),
             note:   String(r[map['req_note']]||''),
             by:     String(r[map['req_by']]||'')
           } : null
    };
  });
}
function saveSiteReq(r){
  var url = r.docFile ? saveFile(r.docFile, 'DOC_'+r.ref) : '';
  upsert('SITE_REQUESTS','request_id',r.id,{
    request_id:r.id, ref:r.ref, type:r.type, site_id:r.siteId||'',
    district_before:(r.before||{}).district||'', area_before:(r.before||{}).area||'',
    facility_before:(r.before||{}).facility||'',
    district_after:r.after.district, area_after:r.after.area, facility_after:r.after.facility,
    source:r.source, doc_ref:r.docRef, doc_date:r.docDate, doc_file_url:url,
    requester:r.reqName, requester_uid:r.reqUid, 'function':r.reqFn, matricule:r.reqMat||'',
    id_type:r.idType||'', id_number:r.idNumber||'', phone:r.phone, email:r.email||'',
    justification:r.justification||'',
    gps_lat:r.gps?r.gps.lat:'', gps_lng:r.gps?r.gps.lng:'',
    status:r.status, decided_by:r.decidedBy||'', decided_at:r.decidedAt?new Date(r.decidedAt):'',
    decision_note:r.decisionNote||'', submitted_at:new Date(r.deviceTs||Date.now())
  });
  if(r.status==='APPROVED' && r.siteId){
    upsert('SITES','site_id',r.siteId,{
      site_id:r.siteId, district:r.after.district, area:r.after.area, facility:r.after.facility,
      status:'ACTIVE', version:1, updated_at:new Date()
    });
  }
}
function saveVisit(p){
  var v = p.visit || p;
  upsert('VISITS','visit_id',v.id,{
    visit_id:v.id, cycle_id:v.cycleId, site_id:v.siteId,
    district:v._district||'', area:v._area||'', facility:v._facility||'',
    supervisor:v.supervisor, supervisor_uid:v.uid, visit_date:v.date, team:v.team||'', status:v.status,
    score_overall: v.scores ? round1(v.scores.overall.pct) : '',
    score_clinical:v.scores ? round1(v.scores.clinical.pct) : '',
    score_mne:     v.scores ? round1(v.scores.mne.pct) : '',
    answered: v.scores ? v.scores.overall.answered : '',
    na_count: v.scores ? v.scores.overall.na : '',
    submitted_at: v.submitted ? new Date(v.submitted) : '',
    reviewed_by:v.reviewedBy||'', reviewed_at:v.reviewedAt?new Date(v.reviewedAt):'',
    review_note:v.reviewNote||'',
    months_complete: JSON.stringify(v.monthsComplete||[]),
    updated_at: new Date(v.updated || Date.now()),
    raw: JSON.stringify(v)
  });
  if(p.answers) writeAnswers(v.id, p.answers);
  markConflicts(v.cycleId, v.siteId);
  if(v.swot) upsert('SWOT','visit_id',v.id,{visit_id:v.id, forces:v.swot.f, faiblesses:v.swot.w,
                                            opportunites:v.swot.o, menaces:v.swot.t});
  if(p.actions) p.actions.forEach(function(a){
    upsert('ACTIONS','action_id',a.id,{
      action_id:a.id, visit_id:a.visitId, site_id:a.siteId, cycle_id:a.cycleId,
      question_code:a.qid||'', section:a.sec||'', root_cause:a.root||'',
      action_onsite:a.onsite||'', recommendation:a.reco||'', responsible:a.resp||'',
      deadline:a.deadline||'', status:a.status, site_note:a.siteNote||'',
      created_at:new Date(a.created||Date.now()), updated_at:new Date(a.updated||Date.now())
    });
  });
}
/* =====================================================================
   ONE SUPERVISION PER SITE PER CYCLE

   The rule in the field is one supervisor phone per site. When two phones
   submit the same site for the same cycle anyway — a team that split up, a
   phone that was reinstalled, a visit begun twice — the second submission is
   not silently accepted and it is not silently refused. Both are flagged, both
   are held OUT of every score, and the supervisor decides which one counts.

   The console never decides. It can see the conflict; it cannot resolve it.
   ===================================================================== */
/* Everything alive on this facility for this cycle, drafts included: what decides
   whether a second supervisor may open it at all. */
function claimedVisitRows(cycleId, siteId){
  return rowsOf('VISITS').filter(function(r){
    return String(r.cycle_id)===String(cycleId) && String(r.site_id)===String(siteId)
        && ['DRAFT','SUBMITTED','APPROVED','RETURNED'].indexOf(String(r.status||'').toUpperCase()) >= 0;
  });
}
function liveVisitRows(cycleId, siteId){
  return rowsOf('VISITS').filter(function(r){
    return String(r.cycle_id)===String(cycleId) && String(r.site_id)===String(siteId)
        && ['SUBMITTED','APPROVED','RETURNED'].indexOf(String(r.status||'').toUpperCase()) >= 0;
  });
}
/** Write the conflict column for every submitted visit of this site+cycle.
 *  Self-healing: it is recomputed from scratch each time, so a resolved conflict
 *  clears itself and a re-uploaded visit cannot resurrect a stale flag. */
function markConflicts(cycleId, siteId){
  var rows = liveVisitRows(cycleId, siteId);
  var ids  = rows.map(function(r){ return String(r.visit_id); });
  var sh = sheet('VISITS'), map = headerMap(sh);
  if(map['conflict'] === undefined) return 0;      // workbook not upgraded yet: do nothing
  var last = sh.getLastRow(); if(last < 2) return 0;
  var keys = sh.getRange(2, map['visit_id']+1, last-1, 1).getValues();
  var n = 0;
  for(var r=0; r<keys.length; r++){
    var id = String(keys[r][0]);
    if(ids.indexOf(id) < 0) continue;
    var others = ids.filter(function(x){ return x !== id; });
    var want = (ids.length > 1) ? others.join(',') : '';
    var cell = sh.getRange(r+2, map['conflict']+1);
    if(String(cell.getValue()||'') !== want){
      cell.setValue(want);
      /* The phones pull what changed SINCE they last asked. A flag written without
         touching updated_at is a change no phone would ever be told about — it would
         clear on the server and stay for ever on every device. */
      if(map['updated_at'] !== undefined) sh.getRange(r+2, map['updated_at']+1).setValue(new Date());
      n++;
    }
  }
  return n;
}
/** The supervisor's decision. Only somebody who owns one of the conflicting
 *  supervisions may take it — not an administrator, not the console. */
function resolveConflict(p){
  var keepId = String(p.keepId||''), by = String(p.byId||'');
  if(!keepId) return {ok:false, error:'no visit chosen'};
  var all = rowsOf('VISITS');
  var keep = all.filter(function(r){ return String(r.visit_id)===keepId; })[0];
  if(!keep) return {ok:false, error:'unknown supervision'};
  var group = liveVisitRows(keep.cycle_id, keep.site_id);
  if(group.length < 2) return {ok:true, already:true};
  var mine = group.filter(function(r){ return String(r.supervisor_uid||'')===by; });
  if(!mine.length) return {ok:false, error:'only a supervisor who owns one of these supervisions can resolve it'};

  var drops = group.filter(function(r){ return String(r.visit_id)!==keepId; });
  drops.forEach(function(r){
    upsert('VARCHIVE','visit_id',String(r.visit_id),{
      visit_id:String(r.visit_id), cycle_id:r.cycle_id, site_id:r.site_id,
      facility:r.facility, supervisor:r.supervisor, visit_date:fmtDate(r.visit_date),
      status:r.status, kept_id:keepId, archived_by:by, archived_at:new Date(),
      raw:String(r.raw||'')});
    deleteRowsWhere('VISITS','visit_id',String(r.visit_id));
    deleteRowsWhere('ANSWERS','visit_id',String(r.visit_id));
    deleteRowsWhere('SWOT','visit_id',String(r.visit_id));
    deleteRowsWhere('ACTIONS','visit_id',String(r.visit_id));
  });
  markConflicts(keep.cycle_id, keep.site_id);
  return {ok:true, kept:keepId, archived:drops.map(function(r){ return String(r.visit_id); })};
}
function deleteRowsWhere(name, col, val){
  var sh = sheet(name), map = headerMap(sh), last = sh.getLastRow();
  if(last < 2 || map[col] === undefined) return 0;
  var keys = sh.getRange(2, map[col]+1, last-1, 1).getValues();
  var n = 0;
  for(var r=keys.length-1; r>=0; r--) if(String(keys[r][0])===String(val)){ sh.deleteRow(r+2); n++; }
  return n;
}

function writeAnswers(visitId, answers){
  var sh = sheet('ANSWERS');
  // remove previous rows for this visit, then rewrite (submissions are immutable once approved)
  var last = sh.getLastRow();
  if(last > 1){
    var col = sh.getRange(2,1,last-1,1).getValues();
    for(var r=col.length-1; r>=0; r--) if(String(col[r][0])===String(visitId)) sh.deleteRow(r+2);
  }
  var map = headerMap(sh), width = sh.getLastColumn();
  var rows = [];
  Object.keys(answers).forEach(function(qc){
    var a = answers[qc];
    var o = { visit_id:visitId, question_code:qc, n:a._n||'', month:a._month||'', section:a._sec||'', domain:a._dom||'',
      numerator:   a.na?'NA':(a.num!==undefined?a.num:(a.v===true?1:a.v===false?0:'')),
      denominator: a.na?'NA':(a.den!==undefined?a.den:(a.v===undefined?'':1)),
      na: a.na?'OUI':'', na_reason:a.naReason||'',
      score_pct: a._pct===undefined?'':a._pct, band:a._band||'', comment:a.comment||'',
      /* The columns above are for a human reading the sheet. They flatten a yes/no to 1/0
         and drop the follow-up, the delay and the checklist, so they cannot rebuild the
         answer on another phone. This one can. */
      raw: JSON.stringify(a) };
    var row = new Array(width).fill('');
    Object.keys(o).forEach(function(c){ var i=map[c]; if(i!==undefined && i<width) row[i]=o[c]; });
    rows.push(row);
  });
  if(rows.length) sh.getRange(sh.getLastRow()+1,1,rows.length,width).setValues(rows);
}
/* ---------------------------------------------------------------------
   A CONVERSATION HAS TO EXIST ON MORE THAN ONE PHONE

   Messages were uploaded and handed back to everybody. The THREAD they
   belong to never left the phone that created it. So a supervisor opened a
   conversation about a facility, wrote in it, and the message arrived on
   every other phone attached to a thread none of them had — which means it
   was filtered out of every list and seen by nobody. It was not lost; it
   was invisible, which is worse, because the sender had no way to tell.
   --------------------------------------------------------------------- */
function saveThread(t){
  if(!t || !t.id) return;
  upsert('THREADS','thread_id',t.id,{
    thread_id:t.id, scope:t.scope||'', site_id:t.siteId||'', visit_id:t.visitId||'',
    title:t.title||'', members:(t.members||[]).join(', '),
    created_at:t.created?new Date(t.created):new Date()
  });
}
function saveMessage(m){
  upsert('MESSAGES','message_id',m.id,{
    message_id:m.id, thread_id:m.threadId, scope:m.scope||'', site_id:m.siteId||'',
    author_uid:m.uid, author:m.who, body:m.body, sent_at:new Date(m.ts)
  });
}
function saveQuestions(list){
  (list||[]).forEach(function(q){
    upsert('QUESTIONS','question_code',q.id,{
      question_code:q.id, n:q.n, section:q.sec, question_fr:q.q, type:q.type, domain:q.dom,
      numerator:q.num||'', denominator:q.den||'', default_den:q.defDen||'', weight:q.weight||1,
      follow_up:q.fu||'', is_dqa:q.dqa?'OUI':'', per_month:q.perMonth?'OUI':'',
      active:q.active!==false, version:q.version||1, items:q.items?JSON.stringify(q.items):'',
      subtitle:q.sub||'', gate:q.gate?'OUI':'', den_from:q.denFrom||'',
      sample_group:q.sampleGroup||'', no_child:q.noChild?'OUI':'', sort_order:q.order||''
    });
  });
}

/* =====================================================================
   PUBLISHING A QUESTIONNAIRE VERSION

   The questionnaire lives in two places: inside the app file, where it is
   built and shipped, and in the QUESTIONS tab, which is what the phones
   actually read on every pull. Until now nothing ever carried the first
   into the second. A corrected questionnaire therefore survived exactly as
   long as it took the phone to sync, and then the old one came back.

   An upgraded app publishes its set once. The stamp is what makes this
   safe: a build may only write a questionnaire NEWER than the one already
   there, so a phone still running last week's file cannot push last week's
   questions back over this week's.

   Codes no longer present are DEACTIVATED, never deleted: a supervision
   submitted against Q39 keeps a question to point at.
   ===================================================================== */
function publishQuestions(p){
  var stamp = String(p.stamp||'');
  if(!stamp) return {ok:false, error:'a questionnaire must carry its version stamp'};
  var have = String(getSetting('questionnaire_version')||'');
  if(have && stamp <= have)
    return {ok:true, skipped:true, current:have,
            note:'the workbook already holds this questionnaire version or a newer one'};

  var list = p.questions||[];
  if(!list.length) return {ok:false, error:'no questions'};

  /* ---- ONE READ, ONE WRITE ---------------------------------------------------------
     This used to call saveQuestions(), which upserts one question at a time — and every
     upsert reads the whole key column and writes one row. Sixty questions meant a
     hundred and twenty round trips to the spreadsheet, thirty to ninety seconds, with
     the script lock held for all of it.

     Every other phone's POST then queued behind that lock, waited its twenty-five
     seconds and gave up. Reads were unaffected, because doGet takes no lock — which is
     exactly the "lecture : ok · écriture : unreachable" the field reported. It was not
     a password problem and never had been.

     The whole block is now built in memory and written in a single setValues(). */
  var sh = sheet('QUESTIONS'), map = headerMap(sh), width = sh.getLastColumn();
  var last = sh.getLastRow();
  var head = TABS.QUESTIONS;

  var byCode = {}, order = [];
  if(last > 1){
    var existing = sh.getRange(2, 1, last-1, width).getValues();
    for(var i=0;i<existing.length;i++){
      var code = String(existing[i][map['question_code']]||'');
      if(!code) continue;
      if(byCode[code] === undefined){ byCode[code] = existing[i]; order.push(code); }
    }
  }
  var keep = {};
  list.forEach(function(q){ keep[String(q.id)] = 1; });

  var cell = function(q){
    var r = new Array(width).fill('');
    var vals = {
      question_code:q.id, n:q.n, section:q.sec, question_fr:q.q, type:q.type, domain:q.dom,
      numerator:q.num||'', denominator:q.den||'', default_den:q.defDen||'', weight:q.weight||1,
      follow_up:q.fu||'', is_dqa:q.dqa?'OUI':'', per_month:q.perMonth?'OUI':'',
      active:true, version:q.version||1, items:q.items?JSON.stringify(q.items):'',
      subtitle:q.sub||'', gate:q.gate?'OUI':'', den_from:q.denFrom||'',
      sample_group:q.sampleGroup||'', no_child:q.noChild?'OUI':'', sort_order:q.order||''
    };
    Object.keys(vals).forEach(function(c){
      var ix = map[c]; if(ix === undefined || ix >= width) return;
      if(vals[c] !== undefined && vals[c] !== null) r[ix] = vals[c];
    });
    return r;
  };

  /* the new set, in its own order; then whatever the workbook still holds and the new
     set does not mention, kept in place and switched OFF */
  var block = [], seen = {};
  list.forEach(function(q){ block.push(cell(q)); seen[String(q.id)] = 1; });
  var off = 0;
  order.forEach(function(code){
    if(seen[code]) return;
    var row = byCode[code];
    if(map['active'] !== undefined && map['active'] < width) row[map['active']] = false;
    block.push(row); off++;
  });

  if(last > 1) sh.getRange(2, 1, last-1, width).clearContent();
  if(block.length) sh.getRange(2, 1, block.length, width).setValues(block);
  setSetting('questionnaire_version', stamp);
  saveAudit({id:'QPUB-'+new Date().getTime(), ts:new Date().getTime(),
             user:String(p.who||''), uid:String(p.byId||''),
             action:'QUESTIONNAIRE_PUBLISHED', entity:'question',
             detail:list.length+' questions, version '+stamp+', '+off+' désactivée(s)'});
  return {ok:true, written:list.length, deactivated:off, version:stamp};
}
function saveCycle(c){
  upsert('CYCLES','cycle_id',c.id,{
    cycle_id:c.id, name:c.name, fy:c.fy, quarter:c.q,
    months:(c.months||[]).map(function(m){return (m.m+1)+'/'+m.y;}).join(', '),
    months_complete:(c.monthsComplete||[]).join(', '),
    open:c.open, close:c.close, deadline:c.deadline||'', status:c.status,
    /* The two columns above are for a human reading the sheet: "7/2026, 8/2026, 9/2026".
       They cannot be parsed back reliably, so a cycle opened at the centre never reached
       a single phone. This one can. */
    raw: JSON.stringify(c)
  });
}
function saveAudit(a){
  upsert('AUDIT','event_id',a.id,{ event_id:a.id, timestamp:new Date(a.ts), user:a.user,
    user_id:a.uid, action:a.action, entity:a.entity, detail:a.detail });
}
function round1(v){ return (v===null||v===undefined)?'':Math.round(v*10)/10; }

/* ------------------------------------------------------------------ settings */
/* Was this item generated before the last remise à zéro? Only data kinds are checked —
   an enrolment, a role request or a console setting is never test data. */
function beforeReset(kind, p){
  if(['visit','message','siteReq','audit'].indexOf(kind) < 0) return false;
  var line = Number(getSetting('reset_data_at') || 0);
  if(!line) return false;
  var t = 0;
  if(kind === 'visit'){
    var v = (p && p.visit) || p || {};
    t = Number(v.updated || v.submitted || v.created || 0);
  } else if(kind === 'message'){ t = Number((p && (p.ts || p.created)) || 0); }
  else if(kind === 'siteReq'){ t = Number((p && (p.submitted || p.created || p.decidedAt)) || 0); }
  else if(kind === 'audit'){ t = Number((p && p.ts) || 0); }
  /* No usable timestamp: keep it. Losing real work to a missing field would be far worse
     than letting one stray test row through, which a person can see and delete. */
  if(!t) return false;
  if(t >= line) return false;
  try{
    upsert('AUDIT','event_id','DROP-'+kind+'-'+t+'-'+Math.floor(Math.random()*9999),{
      event_id:'DROP-'+kind+'-'+t+'-'+Math.floor(Math.random()*9999),
      timestamp:new Date(), user:'serveur', action:'REFUS_AVANT_REMISE_A_ZERO',
      entity:kind, detail:'Élément daté du '+fmtDate(new Date(t))+', antérieur à la remise à zéro — non réintégré.'});
  }catch(e){}
  return true;
}

function getSetting(k){
  var sh = sheet('SETTINGS'), map = headerMap(sh), last = sh.getLastRow();
  if(last < 2) return '';
  var rows = sh.getRange(2,1,last-1,sh.getLastColumn()).getValues();
  for(var i=0;i<rows.length;i++) if(String(rows[i][map['key']]) === k) return rows[i][map['value']];
  return '';
}
function setSetting(k, v){ upsert('SETTINGS','key',k,{ key:k, value:v, updated_at:new Date() }); }

/* ------------------------------------------------------------------ start fresh */
/** REMISE À ZÉRO — run from this editor only, never reachable from the app.
 *
 *  startFresh()               clears the test supervisions and everything attached to them.
 *  startFreshIncludingUsers() also removes every account except the super users.
 *
 *  Both take a full copy of the workbook first and return its link, so nothing is ever
 *  actually lost. Both also stamp the reset, and every phone that has signal wipes its own
 *  copy of the test data within a few minutes — you do not have to touch each device.
 *
 *  Kept in both cases: the 84 facilities, the 64 questions, the cycles, the super users.
 *  Removed: visits, answers, SWOT, action plans, site-change requests, messages, threads,
 *  the audit log, and any facility created provisionally during the tests. */
/* ═══════════════════════════════════════════════════════════════════════════
   REMISE À ZÉRO — à exécuter depuis CET éditeur, jamais depuis l'application.

   Le mot de passe de liaison est public par construction : il est dans le fichier
   que chaque téléphone télécharge. Une adresse capable de tout effacer serait donc
   utilisable par quiconque ouvre ce fichier. Ces deux fonctions restent ici.

   · remiseAZero()            → efface les DONNÉES du test. Garde les enrôlements,
                                les formations sanitaires, les questions, les cycles.
   · remiseAZeroAvecComptes() → efface en plus les comptes, SAUF les administrateurs
                                et les super utilisateurs.

   Les deux prennent d'abord une COPIE COMPLÈTE du classeur, et le lien de cette
   sauvegarde est affiché dans le journal d'exécution.
   ═══════════════════════════════════════════════════════════════════════════ */
function remiseAZero(){            var o=doReset(false); Logger.log(o); return o; }
function remiseAZeroAvecComptes(){ var o=doReset(true);  Logger.log(o); return o; }
/* the older names, kept so nothing that referred to them breaks */
function startFresh(){ return doReset(false); }
function startFreshIncludingUsers(){ return doReset(true); }

function doReset(withUsers){
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH-mm');
  var backup = ss.copy('ATHECS — sauvegarde avant remise a zero ' + stamp);

  /* Everything the field test generated. VARCHIVE is here too: a supervision archived
     after a double submission is test data like any other. USERS, SITES, QUESTIONS,
     CYCLES, SETTINGS, MERGES and ARCHIVE are NOT touched — enrolments, the facility
     registry, the questionnaire and the cycles all survive, exactly as asked. */
  ['VISITS','ANSWERS','SWOT','ACTIONS','SITE_REQUESTS','MESSAGES','THREADS','AUDIT','VARCHIVE']
    .forEach(function(n){ clearRows(n); });

  /* The general announcements thread is not test data — it is furniture. Put it back. */
  upsert('THREADS','thread_id','T-GEN',{
    thread_id:'T-GEN', scope:'GENERAL', site_id:'', visit_id:'',
    title:'Annonces régionales — Région de l\'Ouest', created_at:new Date()});

  /* A pending role request is about an ENROLMENT, not about the test data, so it stays
     unless the accounts themselves are being cleared. */

  // facilities invented during the tests go; the 84 real ones stay
  var removedSites = 0;
  var sh = sheet('SITES'), map = headerMap(sh), last = sh.getLastRow();
  if(last > 1 && map['status'] !== undefined){
    var st = sh.getRange(2, map['status']+1, last-1, 1).getValues();
    for(var i=st.length-1; i>=0; i--){
      var v = String(st[i][0]).toUpperCase();
      if(v === 'PROVISIONAL' || v === 'PROVISOIRE'){ sh.deleteRow(i+2); removedSites++; }
    }
  }

  var removedUsers = 0;
  if(withUsers){
    var us = sheet('USERS'), um = headerMap(us), ul = us.getLastRow();
    if(ul > 1 && um['role'] !== undefined){
      var roles = us.getRange(2, um['role']+1, ul-1, 1).getValues();
      for(var r=roles.length-1; r>=0; r--){
        /* KEEP EVERY PRIVILEGED SLOT. This used to keep only SUPER, so the moment
           administrators existed a users reset deleted A001 and A002 — and locked the
           person running it out of their own console, with no way back except the
           Apps Script editor. */
        var rr = String(roles[r][0]).toUpperCase();
        if(rr !== 'SUPER' && rr !== 'ADMIN'){ us.deleteRow(r+2); removedUsers++; }
      }
    }
  }

  var now = new Date().getTime();
  setSetting('reset_data_at', now);
  if(withUsers) setSetting('reset_users_at', now);

  var msg = 'Remise à zéro effectuée.\n'
    + '  Sauvegarde complète : ' + backup.getUrl() + '\n'
    + '  Supervisions, réponses, plans d\'action, demandes de site, messages et journal : effacés.\n'
    + '  Formations sanitaires provisoires supprimées : ' + removedSites + '\n'
    + (withUsers ? '  Comptes supprimés (hors super utilisateurs) : ' + removedUsers + '\n' : '')
    + '  Les téléphones se videront tout seuls dès qu\'ils auront du réseau.';
  Logger.log(msg);
  return msg;
}
function clearRows(name){
  var sh = sheet(name), last = sh.getLastRow();
  if(last > 1) sh.deleteRows(2, last-1);
}

/* ------------------------------------------------------------------ repair */
/** Run ONCE after pasting this version, from the Apps Script editor.
 *
 *  Rows written by an earlier version landed one or more columns to the side, so a status
 *  cell may hold TRUE, a sites cell a date or a browser string. Every device then read a
 *  status it did not recognise and showed "enrolment refused".
 *
 *  This walks the USERS tab and repairs, by header name:
 *    status  — anything that is not PENDING / ACTIVE / SUSPENDED / REJECTED becomes ACTIVE,
 *              unless the row is explicitly deactivated, in which case SUSPENDED.
 *    active  — anything that is not a real boolean becomes TRUE, unless it reads "false".
 *    sites   — entries that are not real site ids from the SITES tab are dropped.
 *    pin_reset_code / pin_reset_at / pin_help_at — anything that is not a plain code or a
 *              date is cleared, so nobody is left with a phantom recovery code.
 *
 *  It returns the list of people it touched. Read that list: anyone in it is now treated as
 *  approved, because the sheet no longer holds the evidence of who was approved and who was
 *  not. Deactivate from the console anyone who should not be active. Nothing is deleted. */
function repairUsers(){
  var sh = sheet('USERS'), map = headerMap(sh), last = sh.getLastRow();
  if(last < 2) return 'USERS is empty — nothing to repair.';
  var width = sh.getLastColumn();
  var rows  = sh.getRange(2,1,last-1,width).getValues();
  var OKST  = ['PENDING','ACTIVE','SUSPENDED','REJECTED'];

  var known = {};
  var ss = sheet('SITES'), sl = ss.getLastRow();
  if(sl > 1){
    var sm = headerMap(ss);
    ss.getRange(2, sm['site_id']+1, sl-1, 1).getValues().forEach(function(r){
      var id = String(r[0]).trim(); if(id) known[id] = 1;
    });
  }

  var touched = [], set = function(row,col,val){ sh.getRange(row, map[col]+1).setValue(val); };
  rows.forEach(function(r,i){
    var row = i+2, why = [];
    var name = String(r[map['name']]||'(sans nom)');

    var isOff = (r[map['active']] === false) || String(r[map['active']]).toLowerCase() === 'false';
    var st = String(r[map['status']]||'').trim().toUpperCase();
    if(OKST.indexOf(st) < 0){
      set(row,'status', isOff ? 'SUSPENDED' : 'ACTIVE');
      why.push('status "'+String(r[map['status']])+'" -> '+(isOff?'SUSPENDED':'ACTIVE'));
    }
    if(r[map['active']] !== true && r[map['active']] !== false){
      set(row,'active', !isOff); why.push('active');
    }
    if(map['sites'] !== undefined){
      var raw = String(r[map['sites']]||'').trim();
      if(raw){
        var keep = raw.split(',').map(function(x){ return x.trim(); })
                      .filter(function(x){ return known[x]; });
        if(keep.join(', ') !== raw){ set(row,'sites', keep.join(', ')); why.push('sites cleaned'); }
      }
    }
    ['pin_reset_code'].forEach(function(c){
      if(map[c] === undefined) return;
      var v = String(r[map[c]]||'').trim();
      if(v && !/^[0-9]{4,8}$/.test(v)){ set(row,c,''); why.push(c+' cleared'); }
    });
    if(map['pin_reset_code'] !== undefined && map['pin_reset_at'] !== undefined){
      var pc2 = String(r[map['pin_reset_code']]||'').trim();
      if(pc2 && !(r[map['pin_reset_at']] instanceof Date)){
        set(row,'pin_reset_code',''); why.push('phantom recovery code cleared');
      }
    }
    ['pin_reset_at','pin_help_at'].forEach(function(c){
      if(map[c] === undefined) return;
      var v = r[map[c]];
      if(v !== '' && !(v instanceof Date)){ set(row,c,''); why.push(c+' cleared'); }
    });
    if(why.length) touched.push(name + ' — ' + why.join('; '));
  });

  var msg = touched.length
    ? ('Repaired ' + touched.length + ' row(s):\n  ' + touched.join('\n  ')
       + '\n\nReview this list in the console (Validations): everyone above is now ACTIVE.')
    : 'Nothing to repair — every row was already clean.';
  Logger.log(msg);
  return msg;
}

/** Read-only check: prints the real column order of a tab next to the expected one.
 *  Use it if a value ever looks like it is in the wrong column again. */
function headerReport(){
  var out = [];
  Object.keys(TABS).forEach(function(name){
    var sh = sheet(name);
    var have = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0]
                 .map(function(h){ return String(h).trim(); });
    var missing = TABS[name].filter(function(w){ return have.indexOf(w) === -1; });
    out.push(name + '\n  sheet:   ' + have.join(' | ')
                  + '\n  missing: ' + (missing.length ? missing.join(', ') : 'none'));
  });
  var msg = out.join('\n\n');
  Logger.log(msg);
  return msg;
}

/* ------------------------------------------------------------------ seeding */
/** Optional: run once to push the 84 sites and 64 questions into the sheet from the app's own seed.
 *  Not required — the app already carries them offline. */
function seedFromApp(){ return 'Use the app: Console ▸ Paramètres ▸ Synchroniser maintenant.'; }

/* ═══════════════════════════════════════════════════════════════════════════
   THE PUBLIC DASHBOARD                                            (v4.5.0)

   A SECOND, READ-ONLY DOOR. It has its own password, and that password is
   PUBLIC BY DESIGN: it is written inside dashboard.html, which anyone with
   the link can read. Treat everything this endpoint returns as published.

   That is why it is built as an ALLOW-LIST. Nothing is copied wholesale from
   a row; every field in the reply is named below by hand. A column added to
   a sheet later cannot leak through it, because nothing reads columns it was
   not told to read.

   WHAT IS DELIBERATELY NOT HERE, and must never be added:
     · supervisor names or uids, team members, who reviewed a supervision
     · any comment, root cause, recommendation text, or what a site replied
     · the whole SWOT sheet, the whole USERS sheet, the whole AUDIT sheet
     · SITE_REQUESTS, which carries identity numbers, phones and emails
     · PINs, and the main TOKEN, which this endpoint never accepts

   ONLY APPROVED SUPERVISIONS ARE PUBLISHED. A draft is a supervisor still
   typing; a submitted one has not been validated by the coordination team.
   Neither belongs on a page the whole country can open.

   THE NAME SWITCH. Facility names are shown by default. Put a row in the
   SETTINGS tab with key `dash_names` and value `NON` and every facility
   becomes a code instead — no redeployment, no new version, it takes effect
   on the next refresh. A circulated link is a one-way door, and this is the
   handle to pull if the naming turns out to be a mistake.
   ═══════════════════════════════════════════════════════════════════════════ */

var DASH_TOKEN = 'ATHECS-DASH-2026';   // read-only. PUBLIC. Never the main TOKEN.

function dashNamesOn(){
  var v = String(getSetting('dash_names') || 'OUI').toUpperCase().trim();
  return !(v === 'NON' || v === 'NO' || v === 'FALSE' || v === '0');
}

/* Stable, collision-free labels: facilities sorted inside their district, so
   the same facility keeps the same code between refreshes. */
function dashCodes(sites){
  var by = {}, map = {};
  sites.forEach(function(s){ (by[s.district] = by[s.district] || []).push(s.facility); });
  Object.keys(by).forEach(function(d){
    by[d].sort();
    var pre = d.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || 'XXX';
    by[d].forEach(function(f, i){ map[d + '|' + f] = pre + '-' + ('0' + (i + 1)).slice(-2); });
  });
  return map;
}

/* A deadline may have been written as a date or as YYYY-MM-DD. Read both. */
function dashLate(v){
  if(!v) return false;
  var t = (v instanceof Date) ? v.getTime() : Date.parse(String(v));
  if(isNaN(t)) return false;
  var today = new Date(); today.setHours(0, 0, 0, 0);
  return t < today.getTime();
}

function dashPayload(wantCycle){
  var named = dashNamesOn();

  var sites = rowsOf('SITES')
    .filter(function(r){ return String(r.status || 'ACTIVE').toUpperCase() !== 'INACTIVE'; })
    .map(function(r){ return {id:String(r.site_id || ''),
                              district:String(r.district || ''),
                              facility:String(r.facility || '')}; })
    .filter(function(s){ return s.id; });
  var codes = dashCodes(sites);
  var label = function(d, f){ return named ? f : (codes[d + '|' + f] || '—'); };

  var cycles = rowsOf('CYCLES').map(function(r){
    return {id:String(r.cycle_id || ''), name:String(r.name || ''),
            status:String(r.status || '')};
  }).filter(function(c){ return c.id; });
  var open = cycles.filter(function(c){ return c.status === 'OPEN'; })[0];
  var shown = String(wantCycle || '') ||
              (open ? open.id : (cycles.length ? cycles[cycles.length - 1].id : ''));

  /* APPROVED only — see the note above. */
  var approved = rowsOf('VISITS').filter(function(r){
    return String(r.status || '') === 'APPROVED';
  });

  /* visit → cycle, for one pass over the answers */
  var visCycle = {}, inCycle = [];
  approved.forEach(function(r){
    var vid = String(r.visit_id || ''); if(!vid) return;
    visCycle[vid] = String(r.cycle_id || '');
    if(visCycle[vid] === shown) inCycle.push(r);
  });

  /* ---------- coverage: how much of the region has been supervised ---------- */
  var planned = {}, done = {}, seen = {};
  sites.forEach(function(s){ planned[s.district] = (planned[s.district] || 0) + 1; });
  inCycle.forEach(function(r){
    var k = String(r.site_id || ''); if(!k || seen[k]) return;
    seen[k] = 1;
    var d = String(r.district || '');
    done[d] = (done[d] || 0) + 1;
  });
  var districts = Object.keys(planned).sort();
  var coverage = {
    planned: sites.length,
    done: Object.keys(seen).length,
    byDistrict: districts.map(function(d){
      return {district:d, planned:planned[d] || 0, done:done[d] || 0};
    })
  };

  /* ---------- scores: POOLED, never an average of percentages ----------
     Σ(numerator × weight) ÷ Σ(denominator × weight), exactly as the app does
     it. Averaging the per-visit percentages would quietly give a small
     facility the same voice as a large one and the dashboard would disagree
     with the report the supervisor is holding. */
  var weight = {};
  rowsOf('QUESTIONS').forEach(function(r){
    weight[String(r.question_code || '')] = Number(r.weight) || 1;
  });

  var secN = {}, secD = {};                    // sections, for the shown cycle
  var cycN = {}, cycD = {};                    // whole cycles, for the trend
  var facN = {}, facD = {};                    // per facility, for the table
  rowsOf('ANSWERS').forEach(function(a){
    var vid = String(a.visit_id || '');
    var cyc = visCycle[vid];
    if(cyc === undefined) return;              // not an approved supervision
    if(String(a.na || '') === 'OUI') return;   // N/A carries no number
    var num = Number(a.numerator), den = Number(a.denominator);
    if(!isFinite(num) || !isFinite(den) || den <= 0) return;
    var base = String(a.question_code || '').replace(/M\d{6}$/, '');
    var w = weight[base] || 1;

    cycN[cyc] = (cycN[cyc] || 0) + num * w;
    cycD[cyc] = (cycD[cyc] || 0) + den * w;

    if(cyc !== shown) return;
    var s = String(a.section || '');
    if(s){ secN[s] = (secN[s] || 0) + num * w; secD[s] = (secD[s] || 0) + den * w; }
    facN[vid] = (facN[vid] || 0) + num * w;
    facD[vid] = (facD[vid] || 0) + den * w;
  });

  var pct = function(n, d){ return (d > 0) ? Math.round((n / d) * 1000) / 10 : null; };

  var sections = Object.keys(secD).sort().map(function(s){
    return {section:s, pct:pct(secN[s], secD[s])};
  });

  /* ---------- the facility table ---------- */
  var facilities = inCycle.map(function(r){
    var vid = String(r.visit_id || '');
    var d = String(r.district || ''), f = String(r.facility || '');
    return {
      name:     label(d, f),
      district: d,
      area:     String(r.area || ''),
      pct:      pct(facN[vid], facD[vid]),
      date:     fmtDate(r.visit_date)
      /* and nothing else. No supervisor, no team, no reviewer, no note. */
    };
  }).sort(function(a, b){ return (b.pct || 0) - (a.pct || 0); });

  /* ---------- trend: OLDEST FIRST, only cycles that actually have data ----------
     Sheet order is the order rows were written, which is not time. Rendered
     straight it drew FY26 Q1 → FY25 Q4 → FY25 Q3 and the line ran backwards:
     a fall read as a rise. Cycles carry a fiscal year and a quarter — sort on
     those, and fall back to the name so an unnumbered cycle still lands
     somewhere sensible rather than wherever it happened to be typed. */
  var byTime = rowsOf('CYCLES').reduce(function(m, r){
    m[String(r.cycle_id || '')] = {fy: Number(r.fy) || 0, q: Number(r.quarter) || 0};
    return m;
  }, {});
  var trend = cycles.filter(function(c){ return cycD[c.id] > 0; })
    .sort(function(a, b){
      var A = byTime[a.id] || {fy:0, q:0}, B = byTime[b.id] || {fy:0, q:0};
      return (A.fy - B.fy) || (A.q - B.q) || String(a.name).localeCompare(String(b.name));
    })
    .map(function(c){ return {cycle:c.name, pct:pct(cycN[c.id], cycD[c.id])}; });

  /* ---------- recommendations: counts only, never the text ---------- */
  var total = 0, resolved = 0, ongoing = 0, overdue = 0;
  rowsOf('ACTIONS').forEach(function(r){
    if(String(r.cycle_id || '') !== shown) return;
    total++;
    var st = String(r.status || 'OPEN').toUpperCase();
    if(st === 'RESOLVED'){ resolved++; return; }
    if(st === 'ONGOING') ongoing++;
    if(dashLate(r.deadline)) overdue++;
  });

  return {
    ok: true,
    generated: new Date().getTime(),
    region: 'Région de l\'Ouest',
    named: named,
    version: SCRIPT_VERSION,
    cycles: cycles.map(function(c){ return {id:c.id, name:c.name, status:c.status}; }),
    cycle: (function(){
      var c = cycles.filter(function(x){ return x.id === shown; })[0];
      return c ? {id:c.id, name:c.name, status:c.status} : null;
    })(),
    coverage: coverage,
    sections: sections,
    facilities: facilities,
    trend: trend,
    actions: {total:total, resolved:resolved, ongoing:ongoing, overdue:overdue,
              rate: total > 0 ? Math.round((resolved / total) * 1000) / 10 : null},
    ahd: dashAhd(label)
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE AHD SECTION OF THE PUBLIC DASHBOARD                        (v4.11.0)

   The same door, the same rules. Still an ALLOW-LIST: every field below is
   named by hand, and nothing is copied out of an entry wholesale.

   WHAT IS DELIBERATELY NOT HERE, and must never be added:
     · the assessment team, or any assessor's name or function
     · any evidence note, comment, corrective action, or who is responsible
       for one — the whole Action_Plan text, in other words
     · the DAMA facility code, TX_CURR, the site tier, the facility level
     · which service entry points a site does or does not have
     · anything at all from a site that has not been VERIFIED

   ONLY VERIFIED ASSESSMENTS ARE PUBLISHED. A submitted one is a site that
   has sent its answers in; it has not been checked, and it can still be sent
   back and corrected. A figure the coordination team has not stood behind
   does not belong on a page the whole country can open.

   THE NAME SWITCH is the mentorship's — the same `dash_names` setting, the
   same codes, applied here through the `label` the caller passes in. One
   handle covers both sections.

   THE SCORE IS THE APP'S, WHICH IS CDC'S: Yes ÷ (Yes + Partial + No), N/A
   excluded, PARTIAL COUNTS AS ZERO, one unresolved P1 gap makes a site
   Critical whatever the percentage, and a site with blanks is Incomplete
   rather than a number. Regional figures are POOLED — Σ ready ÷ Σ applicable
   over the published sites — never an average of percentages, for the same
   reason the mentorship pools: a four-bed health centre and a district
   hospital must not carry the same weight.
   ═══════════════════════════════════════════════════════════════════════════ */
function dashAhd(label){
  /* the instrument itself, joined back out of its cells */
  var frow = rowsOf('FORMS').filter(function(r){
    return String(r.status || '') !== 'ARCHIVED'
        && String(r.layout || '').indexOf('"kind":"ahd"') >= 0;
  })[0];
  if(!frow) return {present:false};
  var L;
  try{
    L = JSON.parse(String(frow.layout || '') + String(frow.layout2 || '')
                 + String(frow.layout3 || '') + String(frow.layout4 || ''));
  }catch(e){ return {present:false}; }
  if(!L || !L.sections || L.sections.length < 3) return {present:false};

  var P = L.sections[0], C = L.sections[1], T = L.sections[2];
  var fid = String(frow.form_id || '');

  var entries = rowsOf('FORM_ENTRIES').filter(function(r){
    return String(r.form_id || '') === fid
        && String(r.status || '').toUpperCase() === 'APPROVED';
  });
  var active = {};
  rowsOf('SITES').forEach(function(r){
    if(String(r.status || 'ACTIVE').toUpperCase() !== 'INACTIVE')
      active[String(r.site_id || '')] = 1;
  });

  /* ---------- one site's score, exactly as ahdScore() in the app ---------- */
  var scored = [];
  entries.forEach(function(r){
    if(!active[String(r.site_id || '')]) return;
    var data;
    try{ data = JSON.parse(String(r.data || 'null')); }catch(e){ return; }
    if(!data) return;
    var resp = data.resp || {};
    var s = {ready:0, applicable:0, na:0, missing:0, p1:0, gaps:0, total:0, dom:{}};
    for(var i = 0; i < C.items.length; i++){
      var it = C.items[i];
      if(it.parent) continue;                 /* a summary is scored from its lines */
      s.total++;
      var d = s.dom[it.d] || (s.dom[it.d] = {ready:0, applicable:0, gaps:0, p1:0});
      var v = String(((resp[it.k] || {}).v) || '');
      if(v === 'Yes'){ s.ready++; s.applicable++; d.ready++; d.applicable++; }
      else if(v === 'Partial' || v === 'No'){
        s.applicable++; d.applicable++; s.gaps++; d.gaps++;
        if(it.p === 'P1'){ s.p1++; d.p1++; }
      }
      else if(v === 'N/A'){ s.na++; }
      else { s.missing++; }
    }
    scored.push({row:r, data:data, s:s});
  });

  var pct = function(n, d){ return (d > 0) ? Math.round((n / d) * 1000) / 10 : null; };
  /* The band code is the APP'S OWN colour word — grey, red, amber, yellow,
     green — not a second vocabulary invented here. The public page and the
     coordinator's screen must not be able to disagree about what a site is,
     and a test compares the two on every run. */
  var bandOf = function(s){
    if(s.missing > 0) return {code:'grey', label:'Incomplete'};
    if(s.p1 > 0 && (L.scoring || {}).p1Override !== false)
      return {code:'red', label:'Critical readiness gap'};
    var bands = ((L.scoring || {}).bands) || [];
    var p = pct(s.ready, s.applicable); if(p === null) p = 0;
    for(var i = 0; i < bands.length; i++)
      if(p >= bands[i].min) return {code:String(bands[i].c), label:String(bands[i].label)};
    return {code:'red', label:'Critical readiness gap'};
  };

  /* ---------- the facility table: a score, a band, and two counts ---------- */
  var facilities = scored.map(function(x){
    var b = bandOf(x.s);
    return {
      name:     label(String(x.row.district || ''), String(x.row.facility || '')),
      district: String(x.row.district || ''),
      pct:      pct(x.s.ready, x.s.applicable),
      band:     b.code,
      bandLabel:b.label,
      gaps:     x.s.gaps,
      p1:       x.s.p1,
      missing:  x.s.missing,
      date:     fmtDate(x.row.approved_at || x.row.filled_at)
      /* and nothing else. No assessor, no evidence, no action, no TX_CURR. */
    };
  }).sort(function(a, b){ return (b.pct || 0) - (a.pct || 0); });

  /* ---------- pooled, over every published site ---------- */
  var R = {ready:0, applicable:0, na:0, missing:0, gaps:0, p1:0, total:0};
  var domN = {}, domD = {}, domG = {}, domP = {};
  scored.forEach(function(x){
    R.ready += x.s.ready; R.applicable += x.s.applicable; R.na += x.s.na;
    R.missing += x.s.missing; R.gaps += x.s.gaps; R.p1 += x.s.p1; R.total += x.s.total;
    Object.keys(x.s.dom).forEach(function(k){
      var d = x.s.dom[k];
      domN[k] = (domN[k] || 0) + d.ready;      domD[k] = (domD[k] || 0) + d.applicable;
      domG[k] = (domG[k] || 0) + d.gaps;       domP[k] = (domP[k] || 0) + d.p1;
    });
  });

  var domains = C.domains.map(function(dm){
    var k = String(dm.n);
    return {n:k, name:String(dm.name || ''), pct:pct(domN[k], domD[k]),
            gaps:domG[k] || 0, p1:domP[k] || 0};
  });

  /* ---------- the five minimum high-priority checks ---------- */
  var allFive = 0;
  var checks = P.checks.map(function(c){
    return {label:String(c.label || ''), yes:0, no:0, blank:0};
  });
  scored.forEach(function(x){
    var ch = ((x.data.profile || {}).checks) || {}, five = 0;
    P.checks.forEach(function(c, i){
      var v = String(((ch[c.k] || {}).v) || '');
      if(v === 'Yes'){ checks[i].yes++; five++; }
      else if(v === 'No') checks[i].no++;
      else checks[i].blank++;
      /* the comment beside it is evidence text and never leaves the workbook */
    });
    if(five === P.checks.length) allFive++;
  });

  /* ---------- training, summarised over the region ----------
     One cadre on one topic at one site is one slot. Trained is Yes; Partial,
     No and blank are all "not yet", which is the same rule the app's own
     readiness table uses, so the two agree. */
  var topics = T.topics.map(function(tp){
    return {label:String(tp.label || ''), trained:0, slots:0, pct:null};
  });
  var cadreRoll = T.cadres.map(function(cd){
    return {label:String(cd.label || ''), trained:0, slots:0, pct:null};
  });
  scored.forEach(function(x){
    var tr = x.data.train || {};
    T.cadres.forEach(function(cd, ci){
      T.topics.forEach(function(tp, ti){
        var v = String(((tr[cd.k] || {})[tp.k]) || '');
        topics[ti].slots++; cadreRoll[ci].slots++;
        if(v === 'Yes'){ topics[ti].trained++; cadreRoll[ci].trained++; }
      });
    });
  });
  topics.forEach(function(o){ o.pct = pct(o.trained, o.slots); });
  cadreRoll.forEach(function(o){ o.pct = pct(o.trained, o.slots); });

  return {
    present:   true,
    title:     String(frow.title || L.title || 'AHD Site Readiness Assessment'),
    status:    String(frow.status || ''),
    assessed:  facilities.length,
    sites:     Object.keys(active).length,
    pct:       pct(R.ready, R.applicable),
    ready:     R.ready,
    applicable:R.applicable,
    na:        R.na,
    missing:   R.missing,
    gaps:      R.gaps,
    p1:        R.p1,
    units:     R.total,
    allFive:   allFive,
    domains:   domains,
    checks:    checks,
    facilities:facilities,
    training:  {byTopic:topics, byCadre:cadreRoll,
                trained: topics.reduce(function(a, o){ return a + o.trained; }, 0),
                slots:   topics.reduce(function(a, o){ return a + o.slots; }, 0)}
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   DECLARATIONS — the two writes                                   (v4.6.0)

   publishForm()   the console defines or retires a form
   saveFormEntry() a coordinator saves one site's answers

   Neither touches a supervision sheet. Both are upserts keyed on an id the
   app generates, so a phone that sends the same thing twice — a flaky
   connection, a retried outbox — writes the same row twice rather than two
   rows, which is the only behaviour that survives the field.
   ═══════════════════════════════════════════════════════════════════════════ */

function publishForm(p){
  var id = String((p && p.id) || '').trim();
  if(!id) return {ok:false, error:'no form id'};
  var layout = p.layout;
  /* A layout that will not stringify is a layout the phones cannot render;
     refuse it here rather than write a row that breaks every client. */
  var blob;
  try{ blob = JSON.stringify(layout || null); }
  catch(e){ return {ok:false, error:'layout is not serialisable'}; }
  /* split across the layout cells rather than refuse: 4 x 45,000 is room for
     any instrument we are likely to be sent */
  var CH = 45000, parts = [];
  for(var o = 0; o < (blob ? blob.length : 0); o += CH) parts.push(blob.substr(o, CH));
  if(parts.length > 4)
    return {ok:false, error:'layout too large even split across four cells ('
                            + blob.length + ')'};

  upsert('FORMS', 'form_id', id, {
    form_id:   id,
    title:     String(p.title || ''),
    subtitle:  String(p.subtitle || ''),
    status:    String(p.status || 'DRAFT').toUpperCase(),
    scope:     String(p.scope || 'SITE').toUpperCase(),
    fillers:   String(p.fillers || 'SUPER').toUpperCase(),
    opens:     p.opens || '',
    closes:    p.closes || '',
    version:   Number(p.version) || 1,
    updated_by:String(p.by || ''),
    updated_at:new Date(),
    layout:    parts[0] || '',
    layout2:   parts[1] || '',
    layout3:   parts[2] || '',
    layout4:   parts[3] || ''
  });
  return {ok:true, id:id, parts:parts.length, chars:(blob||'').length};
}

function saveFormEntry(p){
  var id = String((p && p.id) || '').trim();
  var fid = String((p && p.formId) || '').trim();
  if(!id || !fid) return {ok:false, error:'no entry id or form id'};

  /* A closed or archived form accepts nothing more. The deadline is the
     point of the exercise, and a late edit after the document has gone to
     CDC would make the submission and the workbook disagree. */
  var form = rowsOf('FORMS').filter(function(r){ return String(r.form_id) === fid; })[0];
  if(!form) return {ok:false, error:'unknown form'};
  var st = String(form.status || '').toUpperCase();
  if(st === 'CLOSED' || st === 'ARCHIVED')
    return {ok:false, error:'form is ' + st.toLowerCase()};

  var blob;
  try{ blob = JSON.stringify(p.data || {}); }
  catch(e){ return {ok:false, error:'answers are not serialisable'}; }
  if(blob.length > 45000)
    return {ok:false, error:'answers too large for one cell (' + blob.length + ')'};

  var site = rowsOf('SITES').filter(function(r){
    return String(r.site_id) === String(p.siteId || ''); })[0] || {};

  /* What the answers currently are, as one short string. A signature records
     the hash it was given against; when this changes, that signature is no
     longer a signature of this document and is voided below. */
  var hash = contentHash(blob);
  var prev = rowsOf('FORM_ENTRIES').filter(function(r){
    return String(r.entry_id) === id; })[0];
  var changed = prev && String(prev.content_hash || '') && String(prev.content_hash) !== hash;

  var status = String(p.status || 'DRAFT').toUpperCase();
  if(changed){
    /* An edit after certification sends the entry back for approval. A
       signature that can survive a change to the thing it signed certifies
       nothing, and CDC would be right to say so. */
    voidSignatures(fid, String(p.siteId || ''), 'entry edited after signing');
    if(status === 'APPROVED' || status === 'SIGNED') status = 'SUBMITTED';
  }

  upsert('FORM_ENTRIES', 'entry_id', id, {
    entry_id:  id,
    form_id:   fid,
    site_id:   String(p.siteId || ''),
    /* denormalised from SITES so the sheet reads without a lookup, and so a
       site renamed later keeps the name it had when it was declared */
    district:  String(site.district || p.district || ''),
    area:      String(site.area || p.area || ''),
    facility:  String(site.facility || p.facility || ''),
    status:    status,
    filled_by: String(p.by || ''),
    filled_uid:String(p.uid || ''),
    filled_at: p.at ? new Date(Number(p.at)) : new Date(),
    updated_at:new Date(),
    data:      blob,
    /* why a page was sent back, so the workbook shows the whole round trip */
    sent_back_by:  p.sentBack ? String(p.sentBack.by  || '') : (prev ? prev.sent_back_by  : ''),
    sent_back_at:  p.sentBack ? new Date(Number(p.sentBack.at) || Date.now())
                              : (prev ? prev.sent_back_at : ''),
    sent_back_why: p.sentBack ? String(p.sentBack.why || '') : (prev ? prev.sent_back_why : ''),
    content_hash: hash,
    /* an edit undoes the approval along with the signature */
    approved_by:  changed ? '' : (prev ? prev.approved_by  : ''),
    approved_uid: changed ? '' : (prev ? prev.approved_uid : ''),
    approved_at:  changed ? '' : (prev ? prev.approved_at  : '')
  });
  return {ok:true, id:id, hash:hash, status:status, voided:!!changed};
}

/* ═══════════════════════════════════════════════════════════════════════════
   DECLARATIONS — verification and certification                   (v4.6.0)

   A site's page travels DRAFT → SUBMITTED → APPROVED → SIGNED. Nothing may
   be signed before it is approved, and nothing stays signed through an edit.
   Who may sign is a cell in SETTINGS — fm_bo_uid and fm_pi_uid — so the day
   a Business Official changes, the workbook changes and the app does not.
   ═══════════════════════════════════════════════════════════════════════════ */

/* A small, stable digest. Not a security hash — it answers one question:
   are these the same answers I was shown when I signed? */
function contentHash(s){
  s = String(s || '');
  var h1 = 0x811c9dc5, h2 = 0x01000193;
  for(var i = 0; i < s.length; i++){
    var c = s.charCodeAt(i);
    h1 = (h1 ^ c) * 16777619 >>> 0;
    h2 = (h2 + c * (i + 7)) >>> 0;
  }
  return ('00000000' + h1.toString(16)).slice(-8) +
         ('00000000' + h2.toString(16)).slice(-8) + '-' + s.length;
}

function voidSignatures(formId, siteId, why){
  var sh = sheet('FORM_SIGNATURES'), map = headerMap(sh), last = sh.getLastRow();
  if(last < 2) return 0;
  var n = 0;
  var rows = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
  for(var i = 0; i < rows.length; i++){
    if(String(rows[i][map['form_id']]) !== String(formId)) continue;
    if(String(rows[i][map['site_id']]) !== String(siteId)) continue;
    if(String(rows[i][map['status']]) === 'VOID') continue;
    sh.getRange(i + 2, map['status'] + 1).setValues([['VOID']]);
    /* The drawn signature is removed with it. A voided signature must not be
       sitting in the workbook waiting to be pasted onto something else. */
    sh.getRange(i + 2, map['ink'] + 1).setValues([['']]);
    n++;
  }
  if(n) saveAudit({id:'FMV-' + formId + '-' + siteId + '-' + Date.now(), ts:Date.now(),
                   user:'', uid:'', action:'formSignVoid',
                   entity:formId + '/' + siteId, detail:why || ''});
  return n;
}

function approveFormEntry(p){
  var id = String((p && p.id) || '').trim();
  if(!id) return {ok:false, error:'no entry id'};
  var row = rowsOf('FORM_ENTRIES').filter(function(r){
    return String(r.entry_id) === id; })[0];
  if(!row) return {ok:false, error:'unknown entry'};

  var st = String(row.status || '').toUpperCase();
  if(st === 'DRAFT') return {ok:false, error:'entry is still a draft'};

  var on = p.approved === false ? false : true;
  patch('FORM_ENTRIES', 'entry_id', id, {
    status:       on ? 'APPROVED' : 'SUBMITTED',
    approved_by:  on ? String(p.by  || '') : '',
    approved_uid: on ? String(p.uid || '') : '',
    approved_at:  on ? new Date() : '',
    updated_at:   new Date()
  });
  /* Withdrawing an approval withdraws any signature that rested on it. */
  if(!on) voidSignatures(String(row.form_id || ''), String(row.site_id || ''),
                         'approval withdrawn');
  return {ok:true, id:id, status: on ? 'APPROVED' : 'SUBMITTED'};
}

/* signForm — one signature, or every approved site at once.

   payload: {formId, role:'BO'|'PI', uid, name, title, ink, siteIds:[...]}
   siteIds omitted or 'ALL' means every APPROVED site of that form: the mass
   signature. The result says exactly which sites were signed and which were
   refused, because a silent partial success is how a submission goes to CDC
   with a page missing. */
/* Delete one site's page — for a trial run, or a page entered against the
   wrong facility. It removes the row from the workbook; the phones learn of it
   on the next pull through `formGone`, so a page deleted here does not sit on
   somebody's phone for ever, counting in nothing on the server and in
   everything on the device. Only the console may do it. */
function deleteFormEntry(p){
  var id = String((p && p.id) || '').trim();
  if(!id) return {ok:false, error:'no entry id'};
  var by = userRow(String((p && p.byId) || ''));
  if(!by || ['SUPER','ADMIN'].indexOf(String(by['role'] || '').toUpperCase()) < 0)
    return {ok:false, error:'only a super user or an administrator can delete a page'};

  var sh = sheet('FORM_ENTRIES'), map = headerMap(sh), last = sh.getLastRow();
  if(last < 2) return {ok:false, error:'unknown entry'};
  var rows = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
  var gone = null;
  for(var i = rows.length - 1; i >= 0; i--){
    if(String(rows[i][map['entry_id']]) !== id) continue;
    gone = {formId:String(rows[i][map['form_id']]), siteId:String(rows[i][map['site_id']]),
            facility:String(rows[i][map['facility']])};
    sh.deleteRow(i + 2);
  }
  if(!gone) return {ok:false, error:'unknown entry'};

  voidSignatures(gone.formId, gone.siteId, 'page deleted');
  /* a tombstone, so every phone drops its copy too */
  upsert('FORM_GONE', 'entry_id', id,
         {entry_id:id, form_id:gone.formId, site_id:gone.siteId,
          deleted_by:String(by['name'] || ''), deleted_at:new Date()});
  saveAudit({id:'FMD-' + id + '-' + Date.now(), ts:Date.now(),
             user:String(by['name'] || ''), uid:String(by['user_id'] || ''),
             action:'formDelete', entity:gone.formId + '/' + gone.siteId,
             detail:gone.facility});
  return {ok:true, id:id, siteId:gone.siteId, facility:gone.facility};
}

function signForm(p){
  var fid  = String((p && p.formId) || '').trim();
  var role = String((p && p.role) || '').trim().toUpperCase();
  var uid  = String((p && p.uid) || '').trim();
  if(!fid)  return {ok:false, error:'no form id'};
  if(role !== 'BO' && role !== 'PI') return {ok:false, error:'role must be BO or PI'};

  var form = rowsOf('FORMS').filter(function(r){ return String(r.form_id) === fid; })[0];
  if(!form) return {ok:false, error:'unknown form'};
  if(String(form.status || '').toUpperCase() === 'ARCHIVED')
    return {ok:false, error:'form is archived'};

  /* Who may sign is the workbook's answer, not the app's. */
  var want = String(getSetting(role === 'BO' ? 'fm_bo_uid' : 'fm_pi_uid') || '').trim();
  if(!want) return {ok:false, error:'no ' + role + ' is designated in SETTINGS'};
  if(uid !== want) return {ok:false, error:'this account is not the designated ' + role};

  var ink = String((p && p.ink) || '');
  if(!ink) return {ok:false, error:'no signature was drawn'};
  if(ink.length > 45000) return {ok:false, error:'signature image too large'};

  var entries = rowsOf('FORM_ENTRIES').filter(function(r){
    return String(r.form_id) === fid; });

  var want_sites = (p.siteIds && p.siteIds !== 'ALL') ? [].concat(p.siteIds).map(String) : null;
  var signed = [], refused = [];

  entries.forEach(function(r){
    var sid = String(r.site_id || '');
    if(want_sites && want_sites.indexOf(sid) < 0) return;
    if(String(r.status || '').toUpperCase() !== 'APPROVED' &&
       String(r.status || '').toUpperCase() !== 'SIGNED'){
      if(want_sites) refused.push({siteId:sid, why:'not approved'});
      return;                                   /* mass sign skips the rest silently */
    }
    writeSignature(fid, role, sid, p, String(r.content_hash || ''));
    signed.push(sid);
    /* SIGNED only once both have signed; one signature is not a certification. */
    if(hasBoth(fid, sid))
      patch('FORM_ENTRIES', 'entry_id', String(r.entry_id),
            {status:'SIGNED', updated_at:new Date()});
  });

  if(!signed.length) return {ok:false, error:'nothing approved to sign', refused:refused};

  /* The submission-level row is what the single certification page prints. */
  writeSignature(fid, role, '', p, '');
  saveAudit({id:'FMS-' + fid + '-' + role + '-' + Date.now(), ts:Date.now(),
             user:String(p.by || ''), uid:uid, action:'formSign', entity:fid,
             detail:role + ' signed ' + signed.length + ' site(s)'});
  return {ok:true, role:role, signed:signed, count:signed.length, refused:refused};
}

function writeSignature(fid, role, siteId, p, hash){
  var id = fid + '|' + role + '|' + (siteId || 'SUBMISSION');
  upsert('FORM_SIGNATURES', 'sig_id', id, {
    sig_id:       id,
    form_id:      fid,
    role:         role,
    site_id:      siteId,
    signer_name:  String(p.name  || ''),
    signer_title: String(p.title || ''),
    signer_uid:   String(p.uid   || ''),
    signed_at:    new Date(),
    covers_hash:  String(hash || ''),
    status:       'VALID',
    ink:          String(p.ink || '')
  });
}

function hasBoth(fid, siteId){
  var rows = rowsOf('FORM_SIGNATURES').filter(function(r){
    return String(r.form_id) === fid && String(r.site_id || '') === String(siteId)
        && String(r.status || 'VALID') !== 'VOID'; });
  var roles = {};
  rows.forEach(function(r){ roles[String(r.role)] = true; });
  return !!(roles.BO && roles.PI);
}


/* ═══════════════════════════════════════════════════════════════════════════
   THE FOUNDATIONAL MILESTONE, READY TO PUBLISH                    (v4.6.0)

   Run publishFM_FY27() ONCE from this editor and the request appears on every
   phone at its next connection. Nothing else has to be typed anywhere.

   The layout below was generated from the Word document itself — every label,
   all 28 checklist items, the staffing rows and the certification text are the
   document's own words, down to the underscores on the signature lines. It is
   a string on purpose: the app renders whatever the layout describes, so the
   next request is another row in FORMS and not another version of the app.

   Afterwards, from this same editor:
     setFMOfficers('A001','A002')  who may sign as Business Official and as
                                   Principal Investigator (their ATHECS ids)
     setFMPrinters('A001')         who assembles the submission and therefore
                                   needs the drawn signatures in order to print
     closeFM_FY27()                the deadline passes: no more entries
     archiveFM_FY27()              it leaves every phone; the answers are kept
   ═══════════════════════════════════════════════════════════════════════════ */
var FM_FY27_LAYOUT =
  "{\"id\":\"FM-FY27\",\"title\":\"Foundational Milestone FY27\",\"runningHeader\":\"FY27 Fo" +
  "undational Milestone Documentation for CDC-Cameroon Cooperative Agreements\",\"s" +
  "ectionHeading\":\"Section 3. Site-Level Foundational Milestone Documentation [Co" +
  "mplete for each supported site]\",\"pageBreakAfterItem\":17,\"sections\":[{\"type\":\"" +
  "header\",\"fields\":[{\"k\":\"region\",\"label\":\"Region\",\"from\":\"site.region\",\"readonl" +
  "y\":true},{\"k\":\"district\",\"label\":\"District\",\"from\":\"site.district\",\"readonly\":" +
  "true},{\"k\":\"site\",\"label\":\"Site Name\",\"from\":\"site.facility\",\"readonly\":true}," +
  "{\"k\":\"txcurr\",\"label\":\"TX_CURR as of FY26Q3 (June 30, 2026)\",\"type\":\"number\"}]" +
  "},{\"type\":\"checklist\",\"columns\":[\"Item\",\"Available Now or Will be Available by" +
  " Nov 30, 2026\",\"Comments\"],\"items\":[{\"k\":\"i01\",\"label\":\"At least one functiona" +
  "l computer that can connect to the internet\"},{\"k\":\"i02\",\"label\":\"At least one" +
  " functional phone for ScanForm data reporting\"},{\"k\":\"i03\",\"label\":\"SOP: Algor" +
  "ithm for viral load monitoring\"},{\"k\":\"i04\",\"label\":\"SOP: 3-test algorithm\"},{" +
  "\"k\":\"i05\",\"label\":\"SOP: Index Case Testing\"},{\"k\":\"i06\",\"label\":\"SOP:  5 C’s\"}" +
  ",{\"k\":\"i07\",\"label\":\"SOP: Early Infant Diagnosis\"},{\"k\":\"i08\",\"label\":\"SOP: Sc" +
  "reening for Known Positives\"},{\"k\":\"i09\",\"label\":\"SOP: Return to Care\"},{\"k\":\"" +
  "i10\",\"label\":\"SOP: Advanced HIV Disease\"},{\"k\":\"i11\",\"label\":\"SOP: pALD\"},{\"k\"" +
  ":\"i12\",\"label\":\"SOP: TPT\"},{\"k\":\"i13\",\"label\":\"ICT register\"},{\"k\":\"i14\",\"labe" +
  "l\":\"QA register\"},{\"k\":\"i15\",\"label\":\"ART registers\"},{\"k\":\"i16\",\"label\":\"Disp" +
  "ensation register\"},{\"k\":\"i17\",\"label\":\"TPT register\"},{\"k\":\"i18\",\"label\":\"TB " +
  "Presumptive/Suspect case register\"},{\"k\":\"i19\",\"label\":\"VL register\"},{\"k\":\"i2" +
  "0\",\"label\":\"HVL register\"},{\"k\":\"i21\",\"label\":\"ANC register\"},{\"k\":\"i22\",\"labe" +
  "l\":\"Labor and Delivery register\"},{\"k\":\"i23\",\"label\":\"Patients’ folders-Adult\"" +
  "},{\"k\":\"i24\",\"label\":\"Patients’ folders exposed and infected infant\"},{\"k\":\"i2" +
  "5\",\"label\":\"Daily appointment registers for PLHIV on ART\"},{\"k\":\"i26\",\"label\":" +
  "\"Absent and LTFU tracking tools\"},{\"k\":\"i27\",\"label\":\"AHD register\"},{\"k\":\"i28" +
  "\",\"label\":\"PCR Register\"}]},{\"type\":\"table\",\"title\":\"Site-Level Staffing Summa" +
  "ry\",\"rowHeader\":\"Position/Role Type\",\"columns\":[{\"k\":\"sup\",\"label\":\"# Supporte" +
  "d\",\"type\":\"number\"},{\"k\":\"fil\",\"label\":\"# Filled\",\"type\":\"number\"},{\"k\":\"vac\"," +
  "\"label\":\"# Vacant\",\"type\":\"number\"},{\"k\":\"dte\",\"label\":\"Expected Fill Date For" +
  " Vacant Position(s)\",\"type\":\"text\"},{\"k\":\"nte\",\"label\":\"Notes\",\"type\":\"text\"}]" +
  ",\"rows\":[{\"k\":\"r1\",\"label\":\"APS/Psychosocial/Testers\",\"describe\":false},{\"k\":\"" +
  "r2\",\"label\":\"Data Clerks\",\"describe\":false},{\"k\":\"r3\",\"label\":\"Clinical or Lab" +
  " Mentor\",\"describe\":false},{\"k\":\"r4\",\"label\":\"Cluster Lead/District Mentor\",\"d" +
  "escribe\":false},{\"k\":\"r5\",\"label\":\"Lab/Supply Chain/Sample Transport\",\"describ" +
  "e\":false},{\"k\":\"r6\",\"label\":\"Nurse\",\"describe\":false},{\"k\":\"r7\",\"label\":\"Senio" +
  "r Clinical Officer\",\"describe\":false},{\"k\":\"r8\",\"label\":\"Other (Describe)\",\"de" +
  "scribe\":true}],\"addRows\":true,\"note\":\"Instruction: Include all positions suppo" +
  "rted in whole or in part by the award; for vacant positions, provide the antic" +
  "ipated fill date and current recruitment status. Add additional rows as needed" +
  ".\"},{\"type\":\"certify\",\"title\":\"Section 4: Foundational Milestone Certification" +
  "\",\"text\":\"By signing, I am confirming the accuracy of the information reported" +
  " in the Foundational Milestone document above and that my organization is prep" +
  "ared to conduct activities in alignment with my approved workplan and EPMP, co" +
  "nsistent with the terms and conditions of the award.\",\"lines\":[\"Name: ________" +
  "____________________________________________\",\"Title: ________________________" +
  "_____________________________\",\"Signature: ___________________________________" +
  "______________\",\"Date:\"],\"signers\":[{\"k\":\"bo\",\"label\":\"Business Official:\"},{\"" +
  "k\":\"pi\",\"label\":\"Principal Investigator:\"}]}]}";

function publishFM_FY27(){
  var r = publishForm({
    id:'FM-FY27',
    title:'Foundational Milestone FY27',
    subtitle:'Section 3 \u2014 one page per supported site',
    status:'OPEN',
    scope:'SITE',
    /* Addressed to the COORDINATORS, who hold supervisor accounts. A coordinator
       who also holds a facility account carries the supervisor hat too, so the
       request reaches them in either space. The console sees every request
       regardless, because it verifies, certifies and prints them. */
    fillers:'SUPERVISOR',
    closes:'2026-11-05',      /* the date the document itself gives */
    version:1,
    by:'console',
    layout:JSON.parse(FM_FY27_LAYOUT)
  });
  Logger.log(JSON.stringify(r));
  return r;
}
/* ---------------------------------------------------------------------------
   EDIT THESE THREE LINES, then run setFMPeople() once.

   They are ATHECS account ids — the id shown beside the name in the Console,
   such as A001. Nothing here is a name and nothing here is a PIN.
   --------------------------------------------------------------------------- */
/* The app no longer collects signatures: the certification page is printed with
   its lines blank, for ink. These settings are kept because the server still
   accepts a signature and the workbook still has FORM_SIGNATURES, so nothing
   already recorded is lost — but no screen offers signing, and leaving them
   empty is now the normal state. */
var FM_BO_UID      = '';
var FM_PI_UID      = '';
var FM_PRINT_UIDS  = '';

/* These are ACCOUNT IDS, not claim codes. A claim code is six digits, used once
   on a phone to activate an account; it never appears in this file. An id is
   what the Console shows beside the name: a slot (A001, U005) or an enrolled
   account (U-mg7x2k-14).

   The Business Official and the Principal Investigator must hold their own
   accounts: the signature is drawn on the holder's phone, so an officer's
   signature given from somebody else's account certifies nothing. Assign them
   two free super-user slots from Console ▸ Administration — each assignment
   prints a six-digit code to give that person once. */

function setFMPeople(){
  setFMOfficers(FM_BO_UID, FM_PI_UID);
  setFMPrinters(FM_PRINT_UIDS);
  Logger.log('BO=' + FM_BO_UID + '  PI=' + FM_PI_UID + '  printers=' + FM_PRINT_UIDS);
  return {ok:true, bo:FM_BO_UID, pi:FM_PI_UID, printers:FM_PRINT_UIDS};
}

/* Who may fill which facility is NOT decided here. It is the facilities already
   granted to the account — the same site access the person requested and a super
   user approved, the one the supervisions already run on. There is nothing to
   assign for this request and nothing to undo after it: a coordinator who holds
   their facilities today holds them for this document too.

   An earlier version of this file carried a FORM_ASSIGN sheet with its own
   assignment per request. It was removed: two places deciding the same thing is
   how they come to disagree. */

function setFMOfficers(boUid, piUid){
  setSetting('fm_bo_uid', String(boUid || ''));
  setSetting('fm_pi_uid', String(piUid || ''));
  return {ok:true, bo:boUid, pi:piUid};
}
function setFMPrinters(uids){
  setSetting('fm_print_uids', String(uids || ''));
  return {ok:true, printers:uids};
}
function closeFM_FY27(){
  return publishForm({id:'FM-FY27', title:'Foundational Milestone FY27',
    status:'CLOSED', layout:JSON.parse(FM_FY27_LAYOUT)});
}
function archiveFM_FY27(){
  return publishForm({id:'FM-FY27', title:'Foundational Milestone FY27',
    status:'ARCHIVED', layout:JSON.parse(FM_FY27_LAYOUT)});
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE AHD SITE READINESS TOOL, READY TO PUBLISH                   (v4.9.0)

   Run publishAHD() ONCE from this editor. Afterwards:
     closeAHD()     the assessment window closes; files can still be made
     archiveAHD()   it leaves every phone; the answers stay in the workbook

   The layout was generated from the .xlsx itself — 141 scorable lines over 16
   domains, the six Domain 7 summaries that are scored from the lines beneath
   them, every priority, and the dropdowns exactly as the workbook declares
   them. It is nearly 40,000 characters, so it is stored across the layout
   cells and joined on the way out.

   The app also needs ahd-template.xlsx uploaded beside index.html: the export
   is that workbook with the answers written into it, so the formulas, the
   dropdowns, the bands and the Readiness_Dashboard come back alive.
   ═══════════════════════════════════════════════════════════════════════════ */
var AHD_LAYOUT =
  "{\"id\":\"AHD-FY27\",\"kind\":\"ahd\",\"title\":\"AHD Site Readiness Assessment\",\"sections\":[{\"type\":\"profile\",\"title\":\"Facility profile and assessment record\",\"fields\":[{\"k\":\"site\",\"label\":\"Facility / site name\",\"from\":\"site.facility\",\"readonly\":true},{\"k\":\"dama\",\"label\":\"DAMA facility ID / site code\",\"type\":\"text\"},{\"k\":\"region\",\"label\":\"Region\",\"from\":\"const:Ouest\",\"readonly\":true},{\"k\":\"district\",\"label\":\"Health district\",\"from\":\"site.district\",\"readonly\":true},{\"k\":\"level\",\"label\":\"Facility level\",\"type\":\"select\",\"options\":[\"Primary\",\"Secondary\",\"Tertiary\",\"Other\"]},{\"k\":\"adate\",\"label\":\"Assessment date\",\"type\":\"today\",\"readonly\":true},{\"k\":\"tier\",\"label\":\"Site tier\",\"type\":\"computed\",\"from\":\"tier(txcurr)\",\"readonly\":true,\"options\":[\"Tier 1\",\"Tier 2\",\"Tier 3\",\"Tier 4\"]},{\"k\":\"txcurr\",\"label\":\"Number of clients currently on ART (TX_CURR)\",\"type\":\"number\"},{\"k\":\"team\",\"label\":\"Assessment team / assessor(s)\",\"type\":\"people\"},{\"k\":\"partner\",\"label\":\"Implementing partner\",\"type\":\"text\",\"default\":\"NACC\"}],\"entryTitle\":\"Service entry points assessed (drop-down)\",\"entries\":[{\"k\":\"e1\",\"label\":\"HIV testing\"},{\"k\":\"e2\",\"label\":\"ART clinic\"},{\"k\":\"e3\",\"label\":\"TB clinic\"},{\"k\":\"e4\",\"label\":\"PMTCT/MCH\"},{\"k\":\"e5\",\"label\":\"OPD/emergency\"},{\"k\":\"e6\",\"label\":\"Inpatient ward\"},{\"k\":\"e7\",\"label\":\"Pediatric/adolescent clinic\"},{\"k\":\"e8\",\"label\":\"Laboratory\"},{\"k\":\"e9\",\"label\":\"Pharmacy\"},{\"k\":\"e10\",\"label\":\"Community/home-based services\"}],\"entryOptions\":[\"YES\",\"NO\"],\"checkTitle\":\"Minimum high-priority readiness checks\",\"checkCols\":[\"Ready?\",\"Evidence / comments\"],\"checks\":[{\"k\":\"h1\",\"label\":\"AHD identification: rapid CD4 testing (including VISITECT where used) or WHO staging is accessible, documented the same day, and linked to clinical action.\"},{\"k\":\"h2\",\"label\":\"TB screening and diagnosis: symptom screening plus GeneXpert or another WHO-recommended low-complexity automated NAAT, N-POC/NPOC-NAAT where implemented, sample transport, and urine LF-LAM for eligible AHD or seriously ill clients.\"},{\"k\":\"h3\",\"label\":\"Cryptococcal disease: CrAg access, fluconazole/pre-emptive treatment, meningitis referral, lumbar-puncture pathway, and ART-delay SOP.\"},{\"k\":\"h4\",\"label\":\"Core prophylaxis, treatment, nutrition, and supportive-care commodities are available on site or through a documented referral/resupply pathway.\"},{\"k\":\"h5\",\"label\":\"Referral, discharge, early follow-up, missed-visit tracking, and DAMA documentation are active and confidentiality-protected.\"}],\"checkOptions\":[\"Yes\",\"No\"],\"bands\":[\"Ready\",\"Substancially Ready\",\"Partially Ready\",\"Critical Readiness Gap\",\"Incomplete/No data\"]},{\"type\":\"scored\",\"title\":\"Facility Preparedness Checklist — 111 Parent Questions / 141 Scorable Response Units (OI sub-responses embedded)\",\"cols\":{\"no\":\"Item no.\",\"pri\":\"Priority level.\",\"req\":\"Preparedness requirement\",\"resp\":\"Response\",\"ev\":\"Evidence / notes\",\"who\":\"Person responsible\",\"due\":\"Proposed deadline\"},\"options\":[\"Yes\",\"Partial\",\"No\",\"N/A\"],\"domains\":[{\"n\":\"1\",\"name\":\"Governance, service model and accountability\"},{\"n\":\"2\",\"name\":\"Screening, early detection and identification of clients with AHD\"},{\"n\":\"3\",\"name\":\"Triage, danger signs, emergency stabilization and referral\"},{\"n\":\"4\",\"name\":\"CD4, laboratory and diagnostic network readiness\"},{\"n\":\"5\",\"name\":\"Tuberculosis screening, diagnosis, prevention and treatment\"},{\"n\":\"6\",\"name\":\"Cryptococcal disease screening, diagnosis, treatment and follow-up\"},{\"n\":\"7\",\"name\":\"Toxoplasmosis and other opportunistic infections readiness\"},{\"n\":\"8\",\"name\":\"Severe bacterial infection, meningitis, pneumonia and sepsis readiness\"},{\"n\":\"9\",\"name\":\"Kaposi’s sarcoma and malignancy care readiness\"},{\"n\":\"10\",\"name\":\"ART initiation, reinitiation, switching and adherence support\"},{\"n\":\"11\",\"name\":\"Prevention package, vaccination, nutrition and client safety\"},{\"n\":\"12\",\"name\":\"Pediatric, adolescent, maternity/PMTCT and family-centered services\"},{\"n\":\"13\",\"name\":\"Pharmacy, commodities and supply-chain readiness\"},{\"n\":\"14\",\"name\":\"Discharge, follow-up, retention and community linkage\"},{\"n\":\"15\",\"name\":\"Data, monitoring, quality improvement and mortality review\"},{\"n\":\"16\",\"name\":\"Human resources, training, supervision and job aids\"}],\"items\":[{\"k\":\"q1_1\",\"no\":\"1.1\",\"d\":\"1\",\"p\":\"P1\",\"q\":\"Facility has a written AHD/OI service SOP aligned with national guidance and current WHO AHD recommendations.\",\"row\":3,\"parent\":false},{\"k\":\"q1_2\",\"no\":\"1.2\",\"d\":\"1\",\"p\":\"P1\",\"q\":\"The SOP defines which AHD/OI services are provided on site, which are referred, and the responsible receiving hub for each service.\",\"row\":4,\"parent\":false},{\"k\":\"q1_3\",\"no\":\"1.3\",\"d\":\"1\",\"p\":\"P1\",\"q\":\"A same-day AHD pathway exists from HIV diagnosis or re-entry to clinical review, CD4/WHO staging, OI screening, prophylaxis/treatment decisions and follow-up booking.\",\"row\":5,\"parent\":false},{\"k\":\"q1_4\",\"no\":\"1.4\",\"d\":\"1\",\"p\":\"P2\",\"q\":\"Facility leadership reviews AHD/OI readiness at least quarterly and assigns owners for unresolved gaps.\",\"row\":6,\"parent\":false},{\"k\":\"q1_5\",\"no\":\"1.5\",\"d\":\"1\",\"p\":\"P2\",\"q\":\"The facility has visible client-flow/job aids for AHD entry points: HIV testing, ART, TB, PMTCT/MCH, inpatient/emergency/OPD, pediatrics and community return-to-care.\",\"row\":7,\"parent\":false},{\"k\":\"q1_6\",\"no\":\"1.6\",\"d\":\"1\",\"p\":\"P2\",\"q\":\"Confidentiality, consent, stigma-reduction and respectful-care expectations are included in AHD/OI workflows.\",\"row\":8,\"parent\":false},{\"k\":\"q2_1\",\"no\":\"2.1\",\"d\":\"2\",\"p\":\"P1\",\"q\":\"Staff use the WHO AHD definition: CD4 <=200 cells/mm3 for adults, adolescents and children >=5 years.\",\"row\":9,\"parent\":false},{\"k\":\"q2_2\",\"no\":\"2.2\",\"d\":\"2\",\"p\":\"P1\",\"q\":\"Children <5 years living with HIV are treated as having AHD unless on ART for >1 year and clinically stable.\",\"row\":10,\"parent\":false},{\"k\":\"q2_3\",\"no\":\"2.3\",\"d\":\"2\",\"p\":\"P1\",\"q\":\"Where CD4 is not available, WHO clinical stage 3 or 4 at presentation is used to identify AHD.\",\"row\":11,\"parent\":false},{\"k\":\"q2_4\",\"no\":\"2.4\",\"d\":\"2\",\"p\":\"P1\",\"q\":\"CD4 testing or clinical staging is triggered for all newly diagnosed clients, clients returning after interruption, clients with suspected/confirmed treatment failure and seriously ill PLHIV.\",\"row\":12,\"parent\":false},{\"k\":\"q2_5\",\"no\":\"2.5\",\"d\":\"2\",\"p\":\"P1\",\"q\":\"ART interruption, missed visits, high viral load, prior OI, weight loss or severe symptoms are flagged as high-risk re-entry triggers.\",\"row\":13,\"parent\":false},{\"k\":\"q2_6\",\"no\":\"2.6\",\"d\":\"2\",\"p\":\"P2\",\"q\":\"AHD status is documented clearly in the clinical record/register/DAMA and visible to clinicians, pharmacy and follow-up teams.\",\"row\":14,\"parent\":false},{\"k\":\"q2_7\",\"no\":\"2.7\",\"d\":\"2\",\"p\":\"P2\",\"q\":\"The facility has a procedure to prevent clients with suspected AHD from leaving before OI screening, prophylaxis/treatment decisions and follow-up are completed.\",\"row\":15,\"parent\":false},{\"k\":\"q3_1\",\"no\":\"3.1\",\"d\":\"3\",\"p\":\"P1\",\"q\":\"Triage staff identify serious illness in adults/adolescents, including respiratory rate >=30/min, heart rate >=120/min, temperature >=39 C or unable to walk unaided.\",\"row\":16,\"parent\":false},{\"k\":\"q3_2\",\"no\":\"3.2\",\"d\":\"3\",\"p\":\"P1\",\"q\":\"Staff recognize urgent symptoms of meningitis, severe pneumonia, sepsis, hypoxia, severe anemia, severe dehydration, seizures, altered mental status and severe malnutrition.\",\"row\":17,\"parent\":false},{\"k\":\"q3_3\",\"no\":\"3.3\",\"d\":\"3\",\"p\":\"P1\",\"q\":\"Emergency assessment and stabilization supplies are available at the appropriate facility level: pulse oximeter, thermometer, BP cuff, oxygen pathway, IV access, fluids and basic resuscitation supplies.\",\"row\":18,\"parent\":false},{\"k\":\"q3_4\",\"no\":\"3.4\",\"d\":\"3\",\"p\":\"P1\",\"q\":\"Referral criteria are written and visible for lumbar puncture, oxygen/IV medicines, radiology, inpatient monitoring, chemotherapy/oncology and specialist pediatric care.\",\"row\":19,\"parent\":false},{\"k\":\"q3_5\",\"no\":\"3.5\",\"d\":\"3\",\"p\":\"P1\",\"q\":\"Transport/referral arrangements include contact numbers, referral forms, transfer notes and escalation options after hours.\",\"row\":20,\"parent\":false},{\"k\":\"q3_6\",\"no\":\"3.6\",\"d\":\"3\",\"p\":\"P2\",\"q\":\"Back-referral communication confirms diagnosis, medicines started, pending results, follow-up appointment and danger signs requiring urgent return.\",\"row\":21,\"parent\":false},{\"k\":\"q3_7\",\"no\":\"3.7\",\"d\":\"3\",\"p\":\"P2\",\"q\":\"AHD/OI emergency cases are reviewed in morbidity/mortality or QI meetings when referral delays, stock-outs or avoidable deterioration occur.\",\"row\":22,\"parent\":false},{\"k\":\"q4_1\",\"no\":\"4.1\",\"d\":\"4\",\"p\":\"P1\",\"q\":\"CD4 testing is available on site or through a functioning sample transport/result-return system with defined turnaround time.\",\"row\":23,\"parent\":false},{\"k\":\"q4_2\",\"no\":\"4.2\",\"d\":\"4\",\"p\":\"P1\",\"q\":\"The facility can collect, test or track specimens for WHO-recommended rapid molecular TB tests, including GeneXpert/low-complexity automated NAAT and N-POC/NPOC-NAAT where implemented, urine LF-LAM, CrAg and other OI tests appropriate to service level and epidemiology.\",\"row\":24,\"parent\":false},{\"k\":\"q4_3\",\"no\":\"4.3\",\"d\":\"4\",\"p\":\"P1\",\"q\":\"Critical results are communicated rapidly to clinicians and documented in the client record and AHD register/DAMA.\",\"row\":25,\"parent\":false},{\"k\":\"q4_4\",\"no\":\"4.4\",\"d\":\"4\",\"p\":\"P2\",\"q\":\"Specimen collection areas protect privacy and infection prevention, including urine collection for LF-LAM and sputum collection for TB testing.\",\"row\":26,\"parent\":false},{\"k\":\"q4_5\",\"no\":\"4.5\",\"d\":\"4\",\"p\":\"P2\",\"q\":\"Quality assurance procedures are in place for point-of-care tests, including staff competency, storage temperatures, lot/expiry checks and external/internal QC where required.\",\"row\":27,\"parent\":false},{\"k\":\"q4_6\",\"no\":\"4.6\",\"d\":\"4\",\"p\":\"P2\",\"q\":\"Safety monitoring tests or referral pathways are available for medicines used in AHD/OI care, including hemoglobin, renal function, liver function and electrolytes where indicated.\",\"row\":28,\"parent\":false},{\"k\":\"q4_7\",\"no\":\"4.7\",\"d\":\"4\",\"p\":\"P2\",\"q\":\"There is a log for specimens sent, results received, abnormal/positive results, client notification and treatment linkage.\",\"row\":29,\"parent\":false},{\"k\":\"q5_1\",\"no\":\"5.1\",\"d\":\"5\",\"p\":\"P1\",\"q\":\"All PLHIV are systematically screened for TB at each health-care visit.\",\"row\":30,\"parent\":false},{\"k\":\"q5_2\",\"no\":\"5.2\",\"d\":\"5\",\"p\":\"P1\",\"q\":\"Adults/adolescents are screened using the WHO four-symptom screen: current cough, fever, weight loss or night sweats.\",\"row\":31,\"parent\":false},{\"k\":\"q5_3\",\"no\":\"5.3\",\"d\":\"5\",\"p\":\"P1\",\"q\":\"Adults/adolescents with HIV who have symptoms, screen positive, are seriously ill or have AHD receive concurrent TB testing with GeneXpert or another WHO-recommended low-complexity automated NAAT, N-POC/NPOC-NAAT where implemented, and urine LF-LAM where indicated.\",\"row\":32,\"parent\":false},{\"k\":\"q5_4\",\"no\":\"5.4\",\"d\":\"5\",\"p\":\"P1\",\"q\":\"A positive LF-LAM, GeneXpert, low-complexity automated NAAT or N-POC/NPOC-NAAT result triggers immediate TB treatment linkage and appropriate drug-resistance evaluation per national guidance.\",\"row\":33,\"parent\":false},{\"k\":\"q5_5\",\"no\":\"5.5\",\"d\":\"5\",\"p\":\"P2\",\"q\":\"Children with HIV are screened using age-appropriate symptoms and have access to respiratory and/or stool GeneXpert or other WHO-recommended NAAT pathways, N-POC/NPOC-NAAT where implemented, and urine LF-LAM where indicated.\",\"row\":34,\"parent\":false},{\"k\":\"q5_6\",\"no\":\"5.6\",\"d\":\"5\",\"p\":\"P1\",\"q\":\"TB preventive treatment is available for eligible PLHIV after TB disease is ruled out; regimen choice follows national guidance.\",\"row\":35,\"parent\":false},{\"k\":\"q5_7\",\"no\":\"5.7\",\"d\":\"5\",\"p\":\"P1\",\"q\":\"ART timing guidance is available for TB: start ART as soon as possible and within two weeks of TB treatment unless meningitis is suspected/confirmed or national guidance indicates otherwise.\",\"row\":36,\"parent\":false},{\"k\":\"q5_8\",\"no\":\"5.8\",\"d\":\"5\",\"p\":\"P2\",\"q\":\"The facility has TB infection prevention procedures for cough triage, separation/ventilation, masks and sputum collection.\",\"row\":37,\"parent\":false},{\"k\":\"q5_9\",\"no\":\"5.9\",\"d\":\"5\",\"p\":\"P2\",\"q\":\"TB/HIV co-management responsibilities, referral and follow-up are clearly assigned between HIV and TB services.\",\"row\":38,\"parent\":false},{\"k\":\"q6_1\",\"no\":\"6.1\",\"d\":\"6\",\"p\":\"P1\",\"q\":\"CrAg screening or referral is available for adults/adolescents and eligible clients with AHD before ART initiation or reinitiation, according to national/WHO guidance.\",\"row\":39,\"parent\":false},{\"k\":\"q6_2\",\"no\":\"6.2\",\"d\":\"6\",\"p\":\"P1\",\"q\":\"All CrAg-positive clients are assessed for headache, neck stiffness, fever, confusion, visual symptoms, seizures or other signs of meningitis.\",\"row\":40,\"parent\":false},{\"k\":\"q6_3\",\"no\":\"6.3\",\"d\":\"6\",\"p\":\"P1\",\"q\":\"Suspected cryptococcal meningitis has a rapid referral pathway for lumbar puncture, CSF CrAg/India ink/culture as available and CSF opening-pressure management.\",\"row\":41,\"parent\":false},{\"k\":\"q6_4\",\"no\":\"6.4\",\"d\":\"6\",\"p\":\"P1\",\"q\":\"Fluconazole is available for pre-emptive treatment/prophylaxis or maintenance according to national protocols.\",\"row\":42,\"parent\":false},{\"k\":\"q6_5\",\"no\":\"6.5\",\"d\":\"6\",\"p\":\"P1\",\"q\":\"Hospital/hub pathway provides access to recommended cryptococcal meningitis induction regimens or safe alternatives, including amphotericin formulation and flucytosine where available.\",\"row\":43,\"parent\":false},{\"k\":\"q6_6\",\"no\":\"6.6\",\"d\":\"6\",\"p\":\"P1\",\"q\":\"Medicine safety monitoring is available for cryptococcal meningitis treatment, including renal function, electrolytes, hemoglobin, IV fluids and electrolyte replacement at hub level.\",\"row\":44,\"parent\":false},{\"k\":\"q6_7\",\"no\":\"6.7\",\"d\":\"6\",\"p\":\"P1\",\"q\":\"ART timing SOP states that ART is deferred 4-6 weeks after starting antifungal treatment for cryptococcal meningitis.\",\"row\":45,\"parent\":false},{\"k\":\"q6_8\",\"no\":\"6.8\",\"d\":\"6\",\"p\":\"P2\",\"q\":\"Clients treated for cryptococcal disease have documented consolidation/maintenance plan, appointment schedule, adherence support and criteria for referral back.\",\"row\":46,\"parent\":false},{\"k\":\"q6_9\",\"no\":\"6.9\",\"d\":\"6\",\"p\":\"P2\",\"q\":\"CrAg testing, positive results, treatment initiation, referral completion and outcomes are monitored monthly.\",\"row\":47,\"parent\":false},{\"k\":\"q7_1\",\"no\":\"7.1\",\"d\":\"7\",\"p\":\"P1\",\"q\":\"Staff can recognize and promptly assess the clinical features and danger signs associated with:\",\"row\":48,\"parent\":true},{\"k\":\"q7_1_1\",\"no\":\"7.1.1\",\"d\":\"7\",\"p\":\"P1\",\"q\":\"Toxoplasmosis\\n\\nClinical features: new or severe headache, fever, focal neurological deficit or weakness, seizures, confusion or reduced consciousness.\\nDanger signs: convulsions, unconsciousness, rapidly worsening focal signs, inability to walk or drink, repeated vomiting, or signs of raised intracranial pressure requiring urgent stabilization/referral.\",\"row\":49,\"parent\":false},{\"k\":\"q7_1_2\",\"no\":\"7.1.2\",\"d\":\"7\",\"p\":\"P1\",\"q\":\"Pneumocystis pneumonia\\n\\nClinical features: subacute non-productive cough, progressive shortness of breath, rapid breathing, fever or low-grade fever, bilateral crepitations/reduced air entry, and hypoxaemia.\\nDanger signs: severe respiratory distress, chest indrawing or cyanosis, persistently low oxygen saturation, exhaustion, altered consciousness, or inability to feed/drink.\",\"row\":50,\"parent\":false},{\"k\":\"q7_1_3\",\"no\":\"7.1.3\",\"d\":\"7\",\"p\":\"P1\",\"q\":\"Histoplasmosis\\n\\nClinical features: persistent fever, marked weight loss, fatigue, cough or dyspnoea, lymphadenopathy, hepatosplenomegaly, mucocutaneous lesions, gastrointestinal symptoms, and pallor/bleeding suggesting cytopenias.\\nDanger signs: shock, severe respiratory distress, altered consciousness/CNS features, severe anaemia/bleeding, or rapid deterioration.\",\"row\":51,\"parent\":false},{\"k\":\"q7_1_4\",\"no\":\"7.1.4\",\"d\":\"7\",\"p\":\"P1\",\"q\":\"Chronic diarrhea\\n\\nClinical features: diarrhoea lasting 14 days or longer, frequent watery or bloody stools, abdominal pain, fever, weight loss, poor intake, and reduced urine output.\\nDanger signs: severe dehydration or shock, lethargy, inability to drink, repeated vomiting, blood in stool, severe malnutrition, sepsis, or worsening renal function.\",\"row\":52,\"parent\":false},{\"k\":\"q7_1_5\",\"no\":\"7.1.5\",\"d\":\"7\",\"p\":\"P1\",\"q\":\"Oral/esophageal candidiasis\\n\\nClinical features: oral erythema with removable white-beige plaques, angular cheilitis, painful or difficult swallowing, retrosternal pain, refusal/reluctance to eat, excessive salivation, or crying with feeds.\\nDanger signs: inability to swallow fluids/medicines, dehydration, severe pain, airway concern, or suspected disseminated/refractory disease.\",\"row\":53,\"parent\":false},{\"k\":\"q7_1_6\",\"no\":\"7.1.6\",\"d\":\"7\",\"p\":\"P1\",\"q\":\"Malnutrition\\n\\nClinical features: visible wasting or unintentional weight loss, low BMI/weight-for-height, low MUAC, bilateral pitting oedema, poor appetite, and faltering growth.\\nDanger signs/complications: lethargy, hypoglycaemia, hypothermia, shock/dehydration, severe infection, inability to eat/drink, or oedema with medical complications.\",\"row\":54,\"parent\":false},{\"k\":\"q7_2\",\"no\":\"7.2\",\"d\":\"7\",\"p\":\"P1\",\"q\":\"Appropriate diagnostic tests, clinical assessment tools, specimen referral and result-return pathways are available for:\",\"row\":55,\"parent\":true},{\"k\":\"q7_2_1\",\"no\":\"7.2.1\",\"d\":\"7\",\"p\":\"P1\",\"q\":\"Toxoplasmosis\\n\\nbrain CT/MRI referral where available; Toxoplasma IgG ; CSF testing/PCR\",\"row\":56,\"parent\":false},{\"k\":\"q7_2_2\",\"no\":\"7.2.2\",\"d\":\"7\",\"p\":\"P1\",\"q\":\"Pneumocystis pneumonia\\npulse oximetry; chest X-ray; induced sputum or nasopharyngeal aspirate, and bronchoalveolar lavage at referral level, for microscopy/PCR where available.\",\"row\":57,\"parent\":false},{\"k\":\"q7_2_3\",\"no\":\"7.2.3\",\"d\":\"7\",\"p\":\"P1\",\"q\":\"Histoplasmosis\\ncirculating Histoplasma antigen assay using urine and/or serum where available; fungal microscopy/histopathology and culture through a referral laboratory; full blood count and renal/liver assessment for severity and treatment monitoring.\",\"row\":58,\"parent\":false},{\"k\":\"q7_2_4\",\"no\":\"7.2.4\",\"d\":\"7\",\"p\":\"P1\",\"q\":\"Chronic diarrhea\\nstool examination for ova/parasites and modified acid-fast testing for coccidian parasites where available; stool culture/other pathogen tests based on syndrome and exposure; electrolytes/renal function for severe illness.\",\"row\":59,\"parent\":false},{\"k\":\"q7_2_5\",\"no\":\"7.2.5\",\"d\":\"7\",\"p\":\"P1\",\"q\":\"Oral/esophageal candidiasis\\n hydration and nutrition; clinical diagnosis or treatment trial for typical disease; KOH/Gram stain/culture for atypical, recurrent or refractory cases where available.\",\"row\":60,\"parent\":false},{\"k\":\"q7_2_6\",\"no\":\"7.2.6\",\"d\":\"7\",\"p\":\"P1\",\"q\":\"Malnutrition\\ncalibrated weight scale, length/height board, BMI/weight-for-height and age-appropriate growth charts, MUAC tape,\",\"row\":61,\"parent\":false},{\"k\":\"q7_3\",\"no\":\"7.3\",\"d\":\"7\",\"p\":\"P1\",\"q\":\"Current treatment, prophylaxis where applicable, stabilization and referral protocols are available and used for:\",\"row\":62,\"parent\":true},{\"k\":\"q7_3_1\",\"no\":\"7.3.1\",\"d\":\"7\",\"p\":\"P1\",\"q\":\"Toxoplasmosis\\nco-trimoxazole or pyrimethamine-based regimen according to national guidance); co-trimoxazole prophylaxis for eligible people\",\"row\":63,\"parent\":false},{\"k\":\"q7_3_2\",\"no\":\"7.3.2\",\"d\":\"7\",\"p\":\"P1\",\"q\":\"Pneumocystis pneumonia\\nhigh-dose co-trimoxazole treatment , oxygen and supportive care; adjunctive corticosteroid protocol for severe hypoxaemia/respiratory distress; admission/referral for severe disease or treatment failure; co-trimoxazole prophylaxis and timely ART according to national guidance.\",\"row\":64,\"parent\":false},{\"k\":\"q7_3_3\",\"no\":\"7.3.3\",\"d\":\"7\",\"p\":\"P1\",\"q\":\"Histoplasmosis\\n liposomal amphotericin B induction for severe/moderately severe disseminated disease followed by itraconazole; itraconazole for mild/moderate disease where appropriate; toxicity and interaction monitoring; rapid referral for severe/CNS disease; and ART initiation as soon as clinically appropriate when there is no CNS involvement.\",\"row\":65,\"parent\":false},{\"k\":\"q7_3_4\",\"no\":\"7.3.4\",\"d\":\"7\",\"p\":\"P1\",\"q\":\"Chronic diarrhea\\n low-osmolarity ORS and continued feeding; IV fluids for severe dehydration/shock; zinc for children and nutrition/micronutrient support for persistent diarrhoea;\",\"row\":66,\"parent\":false},{\"k\":\"q7_3_5\",\"no\":\"7.3.5\",\"d\":\"7\",\"p\":\"P1\",\"q\":\"Oral/esophageal candidiasis\\n topical nystatin or miconazole for uncomplicated oral disease where appropriate; systemic fluconazole for oesophageal or extensive disease; hydration, analgesia and nutrition support; referral and alternative therapy for inability to swallow, severe disease, treatment failure, recurrent disease or suspected azole resistance.\",\"row\":67,\"parent\":false},{\"k\":\"q7_3_6\",\"no\":\"7.3.6\",\"d\":\"7\",\"p\":\"P1\",\"q\":\"Malnutrition\\nstabilize hypoglycaemia, hypothermia, infection and dehydration; cautious initial feeding for complicated severe acute malnutrition (for example, F-75), then transition to F-100/RUTF for catch-up growth where indicated; continue breastfeeding/age-appropriate feeding; manage micronutrient needs; refer complicated cases and follow age-specific national protocols.\",\"row\":68,\"parent\":false},{\"k\":\"q7_4\",\"no\":\"7.4\",\"d\":\"7\",\"p\":\"P1\",\"q\":\"Essential medicines, supplies, nutrition commodities and supportive-care inputs are available on site or through a documented referral or resupply pathway for:\",\"row\":69,\"parent\":true},{\"k\":\"q7_4_1\",\"no\":\"7.4.1\",\"d\":\"7\",\"p\":\"P1\",\"q\":\"Toxoplasmosis\\nco-trimoxazole and/or pyrimethamine, sulfadiazine and folinic acid where used); anticonvulsant and emergency-stabilization supplies; IV access/fluids as indicated\",\"row\":70,\"parent\":false},{\"k\":\"q7_4_2\",\"no\":\"7.4.2\",\"d\":\"7\",\"p\":\"P1\",\"q\":\"Pneumocystis pneumonia\\n co-trimoxazole (oral and parenteral where used); reliable oxygen source and delivery devices; pulse oximeter; corticosteroid for severe disease per protocol; IV access/fluids; chest X-ray and respiratory-specimen collection materials; PPE/biosafety supplies; and reliable referral transport.\",\"row\":71,\"parent\":false},{\"k\":\"q7_4_3\",\"no\":\"7.4.3\",\"d\":\"7\",\"p\":\"P1\",\"q\":\"Histoplasmosis\\n  liposomal amphotericin B and itraconazole; IV infusion supplies; renal/electrolyte/liver monitoring; hydration and adverse-event medicines; and documented specialist/inpatient referral.\",\"row\":72,\"parent\":false},{\"k\":\"q7_4_4\",\"no\":\"7.4.4\",\"d\":\"7\",\"p\":\"P1\",\"q\":\"Chronic diarrhea\\nlow-osmolarity ORS; IV fluids and giving sets for severe dehydration; zinc for children; safe-water/feeding supplies and nutrition support; stool containers and transport media; microscopy/culture/relevant pathogen-test access\",\"row\":73,\"parent\":false},{\"k\":\"q7_4_5\",\"no\":\"7.4.5\",\"d\":\"7\",\"p\":\"P1\",\"q\":\"Oral/esophageal candidiasis\\n nystatin or miconazole for oral disease; fluconazole for oesophageal/extensive disease; alternative antifungal/referral access for refractory cases; oral-care supplies, analgesia, safe fluids/feeding support and hydration supplies; and diagnostic/referral access for atypical or non-responsive disease.\",\"row\":74,\"parent\":false},{\"k\":\"q7_4_6\",\"no\":\"7.4.6\",\"d\":\"7\",\"p\":\"P1\",\"q\":\"Malnutrition\\n nationally approved therapeutic feeds; feeding cups/spoons and safe-water supplies; glucose/sugar, appropriate rehydration solution; warmth/temperature monitoring; and referral transport.\",\"row\":75,\"parent\":false},{\"k\":\"q7_5\",\"no\":\"7.5\",\"d\":\"7\",\"p\":\"P2\",\"q\":\"Follow-up, adherence or supportive care, treatment response and referral completion are documented for each priority opportunistic infection or condition in the clinical record and DAMA where applicable:\",\"row\":76,\"parent\":true},{\"k\":\"q7_5_1\",\"no\":\"7.5.1\",\"d\":\"7\",\"p\":\"P2\",\"q\":\"Toxoplasmosis\",\"row\":77,\"parent\":false},{\"k\":\"q7_5_2\",\"no\":\"7.5.2\",\"d\":\"7\",\"p\":\"P2\",\"q\":\"Pneumocystis pneumonia\",\"row\":78,\"parent\":false},{\"k\":\"q7_5_3\",\"no\":\"7.5.3\",\"d\":\"7\",\"p\":\"P2\",\"q\":\"Histoplasmosis\",\"row\":79,\"parent\":false},{\"k\":\"q7_5_4\",\"no\":\"7.5.4\",\"d\":\"7\",\"p\":\"P2\",\"q\":\"Chronic diarrhea\",\"row\":80,\"parent\":false},{\"k\":\"q7_5_5\",\"no\":\"7.5.5\",\"d\":\"7\",\"p\":\"P2\",\"q\":\"Oral/esophageal candidiasis\",\"row\":81,\"parent\":false},{\"k\":\"q7_5_6\",\"no\":\"7.5.6\",\"d\":\"7\",\"p\":\"P2\",\"q\":\"Malnutrition\",\"row\":82,\"parent\":false},{\"k\":\"q7_6\",\"no\":\"7.6\",\"d\":\"7\",\"p\":\"P2\",\"q\":\"Staff competency, job aids, case review, monitoring and quality-improvement processes cover each priority opportunistic infection or condition:\",\"row\":83,\"parent\":true},{\"k\":\"q7_6_1\",\"no\":\"7.6.1\",\"d\":\"7\",\"p\":\"P2\",\"q\":\"Toxoplasmosis\",\"row\":84,\"parent\":false},{\"k\":\"q7_6_2\",\"no\":\"7.6.2\",\"d\":\"7\",\"p\":\"P2\",\"q\":\"Pneumocystis pneumonia\",\"row\":85,\"parent\":false},{\"k\":\"q7_6_3\",\"no\":\"7.6.3\",\"d\":\"7\",\"p\":\"P2\",\"q\":\"Histoplasmosis\",\"row\":86,\"parent\":false},{\"k\":\"q7_6_4\",\"no\":\"7.6.4\",\"d\":\"7\",\"p\":\"P2\",\"q\":\"Chronic diarrhea\",\"row\":87,\"parent\":false},{\"k\":\"q7_6_5\",\"no\":\"7.6.5\",\"d\":\"7\",\"p\":\"P2\",\"q\":\"Oral/esophageal candidiasis\",\"row\":88,\"parent\":false},{\"k\":\"q7_6_6\",\"no\":\"7.6.6\",\"d\":\"7\",\"p\":\"P2\",\"q\":\"Malnutrition\",\"row\":89,\"parent\":false},{\"k\":\"q8_1\",\"no\":\"8.1\",\"d\":\"8\",\"p\":\"P1\",\"q\":\"Facility has protocols for suspected bacterial meningitis, sepsis, severe pneumonia, dehydration, hypoxia and shock in adults, adolescents and children with AHD.\",\"row\":90,\"parent\":false},{\"k\":\"q8_2\",\"no\":\"8.2\",\"d\":\"8\",\"p\":\"P1\",\"q\":\"Empiric antibiotic access or referral pathway is defined for suspected acute bacterial meningitis and severe bacterial infection.\",\"row\":91,\"parent\":false},{\"k\":\"q8_3\",\"no\":\"8.3\",\"d\":\"8\",\"p\":\"P1\",\"q\":\"Blood culture, CSF testing, chest imaging and other diagnostics are available on site or through referral according to facility level.\",\"row\":92,\"parent\":false},{\"k\":\"q8_4\",\"no\":\"8.4\",\"d\":\"8\",\"p\":\"P1\",\"q\":\"Oxygen, pulse oximetry and emergency referral are available for clients with respiratory distress or hypoxia.\",\"row\":93,\"parent\":false},{\"k\":\"q8_5\",\"no\":\"8.5\",\"d\":\"8\",\"p\":\"P2\",\"q\":\"Staff know when to delay ART pending meningitis evaluation and when to seek senior HIV/TB/infectious disease advice.\",\"row\":94,\"parent\":false},{\"k\":\"q8_6\",\"no\":\"8.6\",\"d\":\"8\",\"p\":\"P2\",\"q\":\"Antimicrobial stewardship and pharmacovigilance processes record severe adverse drug reactions, toxicity and antibiotic use.\",\"row\":95,\"parent\":false},{\"k\":\"q9_1\",\"no\":\"9.1\",\"d\":\"9\",\"p\":\"P2\",\"q\":\"Staff routinely screen for skin/oral Kaposi’s sarcoma lesions, edema, ulcerated tumors, respiratory symptoms, GI bleeding symptoms and functional impairment.\",\"row\":96,\"parent\":false},{\"k\":\"q9_2\",\"no\":\"9.2\",\"d\":\"9\",\"p\":\"P2\",\"q\":\"Facility can distinguish likely mild/moderate from severe or symptomatic Kaposi’s sarcoma and document disease extent.\",\"row\":97,\"parent\":false},{\"k\":\"q9_3\",\"no\":\"9.3\",\"d\":\"9\",\"p\":\"P1\",\"q\":\"Immediate ART initiation is available for clients with mild/moderate Kaposi’s sarcoma unless another condition requires ART delay.\",\"row\":98,\"parent\":false},{\"k\":\"q9_4\",\"no\":\"9.4\",\"d\":\"9\",\"p\":\"P1\",\"q\":\"Severe or symptomatic Kaposi’s sarcoma has a rapid referral pathway for systemic chemotherapy/oncology while ART is initiated or continued.\",\"row\":99,\"parent\":false},{\"k\":\"q9_5\",\"no\":\"9.5\",\"d\":\"9\",\"p\":\"P2\",\"q\":\"Referral linkage tracks appointment completion, treatment start, treatment interruption and return-to-care after oncology visits.\",\"row\":100,\"parent\":false},{\"k\":\"q9_6\",\"no\":\"9.6\",\"d\":\"9\",\"p\":\"P3\",\"q\":\"Palliative care, wound care, pain control and psychosocial support are available or linked for clients with advanced malignancy.\",\"row\":101,\"parent\":false},{\"k\":\"q10_1\",\"no\":\"10.1\",\"d\":\"10\",\"p\":\"P1\",\"q\":\"Rapid ART initiation/reinitiation is available for clients with AHD alongside OI screening, prevention and treatment decisions.\",\"row\":102,\"parent\":false},{\"k\":\"q10_2\",\"no\":\"10.2\",\"d\":\"10\",\"p\":\"P1\",\"q\":\"ART delay exceptions are clearly written for cryptococcal meningitis, TB meningitis and other conditions requiring senior clinical review.\",\"row\":103,\"parent\":false},{\"k\":\"q10_3\",\"no\":\"10.3\",\"d\":\"10\",\"p\":\"P1\",\"q\":\"Clients returning after interruption receive same-day clinical assessment, ART reinitiation plan, adherence counselling and OI screening.\",\"row\":104,\"parent\":false},{\"k\":\"q10_4\",\"no\":\"10.4\",\"d\":\"10\",\"p\":\"P1\",\"q\":\"Clients on ART >6 months who are unwell have adherence review and viral load testing where available; elevated viral load triggers action per regimen/national guidance.\",\"row\":105,\"parent\":false},{\"k\":\"q10_5\",\"no\":\"10.5\",\"d\":\"10\",\"p\":\"P2\",\"q\":\"Staff review drug-drug interactions and toxicity risks for ART, TB medicines, antifungals, anticonvulsants, chemotherapy and other OI medicines.\",\"row\":106,\"parent\":false},{\"k\":\"q10_6\",\"no\":\"10.6\",\"d\":\"10\",\"p\":\"P2\",\"q\":\"Adherence support includes treatment literacy, side-effect counselling, pill-burden planning, mental health/substance-use referral and peer/community support where available.\",\"row\":107,\"parent\":false},{\"k\":\"q10_7\",\"no\":\"10.7\",\"d\":\"10\",\"p\":\"P2\",\"q\":\"Counselling materials are understandable to clients and caregivers and include danger signs and when to seek urgent care.\",\"row\":108,\"parent\":false},{\"k\":\"q11_1\",\"no\":\"11.1\",\"d\":\"11\",\"p\":\"P1\",\"q\":\"The AHD package includes screening, treatment and/or prophylaxis for major OIs, rapid ART when safe, and intensified adherence support.\",\"row\":109,\"parent\":false},{\"k\":\"q11_2\",\"no\":\"11.2\",\"d\":\"11\",\"p\":\"P1\",\"q\":\"Eligible clients receive co-trimoxazole, TB preventive treatment, fluconazole/pre-emptive treatment or other prophylaxis according to national guidance.\",\"row\":110,\"parent\":false},{\"k\":\"q11_3\",\"no\":\"11.3\",\"d\":\"11\",\"p\":\"P2\",\"q\":\"Vaccination status is reviewed, including BCG precautions for children living with HIV and other vaccines per national guidance.\",\"row\":111,\"parent\":false},{\"k\":\"q11_4\",\"no\":\"11.4\",\"d\":\"11\",\"p\":\"P2\",\"q\":\"Nutrition assessment and support are available, including weight/BMI or MUAC, food insecurity screening, malnutrition referral and therapeutic feeding pathway when indicated.\",\"row\":112,\"parent\":false},{\"k\":\"q11_5\",\"no\":\"11.5\",\"d\":\"11\",\"p\":\"P2\",\"q\":\"Prevention counselling covers OI danger signs, TB exposure, medicine adherence, safer sex, disclosure support where desired and family/partner testing options.\",\"row\":113,\"parent\":false},{\"k\":\"q11_6\",\"no\":\"11.6\",\"d\":\"11\",\"p\":\"P2\",\"q\":\"Facility ensures safe water, sanitation, hand hygiene, clean clinical areas and sharps/waste management for immunocompromised clients.\",\"row\":114,\"parent\":false},{\"k\":\"q12_1\",\"no\":\"12.1\",\"d\":\"12\",\"p\":\"P1\",\"q\":\"Pediatric AHD criteria are applied consistently and children <5 years living with HIV are not missed.\",\"row\":115,\"parent\":false},{\"k\":\"q12_2\",\"no\":\"12.2\",\"d\":\"12\",\"p\":\"P1\",\"q\":\"Pediatric ART and OI medicine formulations, dosing tools, weight scales, MUAC tape and caregiver counselling materials are available.\",\"row\":116,\"parent\":false},{\"k\":\"q12_3\",\"no\":\"12.3\",\"d\":\"12\",\"p\":\"P1\",\"q\":\"Children with AHD are screened for TB, severe pneumonia, severe bacterial infection, malnutrition and symptomatic meningitis/OIs.\",\"row\":117,\"parent\":false},{\"k\":\"q12_4\",\"no\":\"12.4\",\"d\":\"12\",\"p\":\"P2\",\"q\":\"Adolescent services protect confidentiality and provide developmentally appropriate adherence, mental health and sexual/reproductive health support.\",\"row\":118,\"parent\":false},{\"k\":\"q12_5\",\"no\":\"12.5\",\"d\":\"12\",\"p\":\"P2\",\"q\":\"Pregnant and postpartum clients with AHD receive rapid linkage across HIV, TB, maternity/PMTCT, OI and newborn/infant services.\",\"row\":119,\"parent\":false},{\"k\":\"q12_6\",\"no\":\"12.6\",\"d\":\"12\",\"p\":\"P2\",\"q\":\"Family-centered services include infant/child testing, partner/family testing options, caregiver treatment literacy and appointment coordination.\",\"row\":120,\"parent\":false},{\"k\":\"q12_7\",\"no\":\"12.7\",\"d\":\"12\",\"p\":\"P2\",\"q\":\"Safeguarding, mental health and social protection referral pathways are available for children, adolescents and pregnant/postpartum clients.\",\"row\":121,\"parent\":false},{\"k\":\"q13_1\",\"no\":\"13.1\",\"d\":\"13\",\"p\":\"P1\",\"q\":\"Minimum stock levels and reorder points are defined for AHD diagnostics, ART, co-trimoxazole, TPT, fluconazole, TB medicines, antibiotics and pediatric formulations.\",\"row\":122,\"parent\":false},{\"k\":\"q13_2\",\"no\":\"13.2\",\"d\":\"13\",\"p\":\"P1\",\"q\":\"Critical tracer items are reviewed at least monthly and stock-outs trigger documented mitigation and referral/borrowing procedures.\",\"row\":123,\"parent\":false},{\"k\":\"q13_3\",\"no\":\"13.3\",\"d\":\"13\",\"p\":\"P1\",\"q\":\"Storage conditions, expiry dates, lot numbers and temperature requirements are monitored for diagnostics and medicines such as LF-LAM, CrAg tests and amphotericin-related supplies.\",\"row\":124,\"parent\":false},{\"k\":\"q13_4\",\"no\":\"13.4\",\"d\":\"13\",\"p\":\"P2\",\"q\":\"Quantification accounts for new diagnoses, clients returning after interruption, inpatient discharges, treatment failure and expected AHD prevalence.\",\"row\":125,\"parent\":false},{\"k\":\"q13_5\",\"no\":\"13.5\",\"d\":\"13\",\"p\":\"P2\",\"q\":\"Pharmacy can dispense synchronized refills for ART and OI medicines and flag clients who fail to collect critical medicines.\",\"row\":126,\"parent\":false},{\"k\":\"q13_6\",\"no\":\"13.6\",\"d\":\"13\",\"p\":\"P2\",\"q\":\"Hub/referral facilities have lumbar puncture, CSF testing, amphotericin administration, electrolyte replacement and safety-monitoring supplies where those services are provided.\",\"row\":127,\"parent\":false},{\"k\":\"q13_7\",\"no\":\"13.7\",\"d\":\"13\",\"p\":\"P2\",\"q\":\"Adverse drug reactions, medicine substitutions and interruptions are documented and reported through pharmacovigilance systems.\",\"row\":128,\"parent\":false},{\"k\":\"q14_1\",\"no\":\"14.1\",\"d\":\"14\",\"p\":\"P1\",\"q\":\"Every hospitalized client with HIV/AHD leaves with documented diagnosis, medicines, ART/OI plan, pending results, danger signs and follow-up appointment.\",\"row\":129,\"parent\":false},{\"k\":\"q14_2\",\"no\":\"14.2\",\"d\":\"14\",\"p\":\"P1\",\"q\":\"Discharge planning includes medication review, adherence plan, counselling, referral/back-referral communication and individualized support needs.\",\"row\":130,\"parent\":false},{\"k\":\"q14_3\",\"no\":\"14.3\",\"d\":\"14\",\"p\":\"P1\",\"q\":\"Early post-discharge follow-up is scheduled, including phone call, clinic visit and/or home visit where acceptable and safe.\",\"row\":131,\"parent\":false},{\"k\":\"q14_4\",\"no\":\"14.4\",\"d\":\"14\",\"p\":\"P2\",\"q\":\"Client consent and preferred contact method are documented before phone or home follow-up to protect privacy and confidentiality.\",\"row\":132,\"parent\":false},{\"k\":\"q14_5\",\"no\":\"14.5\",\"d\":\"14\",\"p\":\"P2\",\"q\":\"Community health workers, peer supporters or case managers are linked to AHD clients at high risk of death, readmission or loss to follow-up.\",\"row\":133,\"parent\":false},{\"k\":\"q14_6\",\"no\":\"14.6\",\"d\":\"14\",\"p\":\"P2\",\"q\":\"Missed appointments or missed medicine pickups trigger rapid tracing and fast re-entry without punitive procedures.\",\"row\":134,\"parent\":false},{\"k\":\"q14_7\",\"no\":\"14.7\",\"d\":\"14\",\"p\":\"P2\",\"q\":\"The facility tracks 30-day post-discharge attendance, readmission, death and loss to follow-up for AHD clients.\",\"row\":135,\"parent\":false},{\"k\":\"q15_1\",\"no\":\"15.1\",\"d\":\"15\",\"p\":\"P1\",\"q\":\"AHD register/DAMA captures CD4, WHO stage, AHD status, TB screening/testing, LF-LAM, CrAg, OI diagnosis, prophylaxis, ART action, referral and follow-up outcome.\",\"row\":136,\"parent\":false},{\"k\":\"q15_2\",\"no\":\"15.2\",\"d\":\"15\",\"p\":\"P2\",\"q\":\"Monthly dashboard monitors AHD identification, CD4 coverage, TB screening/testing/treatment, CrAg coverage, OI treatment, stock-outs, hospitalization/discharge, mortality and loss to follow-up.\",\"row\":137,\"parent\":false},{\"k\":\"q15_3\",\"no\":\"15.3\",\"d\":\"15\",\"p\":\"P2\",\"q\":\"Data definitions align with national tools and WHO/UNAIDS-compatible AHD monitoring indicators where applicable.\",\"row\":138,\"parent\":false},{\"k\":\"q15_4\",\"no\":\"15.4\",\"d\":\"15\",\"p\":\"P2\",\"q\":\"Positive OI tests and high-risk clients are reconciled against treatment/referral logs to prevent missed treatment starts.\",\"row\":139,\"parent\":false},{\"k\":\"q15_5\",\"no\":\"15.5\",\"d\":\"15\",\"p\":\"P2\",\"q\":\"Deaths among PLHIV/AHD clients are reviewed for late diagnosis, missed OI screening, stock-out, referral delay, treatment interruption or follow-up gap.\",\"row\":140,\"parent\":false},{\"k\":\"q15_6\",\"no\":\"15.6\",\"d\":\"15\",\"p\":\"P3\",\"q\":\"QI projects are used to improve turnaround time, same-day package completion, commodity availability, discharge linkage and retention.\",\"row\":141,\"parent\":false},{\"k\":\"q15_7\",\"no\":\"15.7\",\"d\":\"15\",\"p\":\"P3\",\"q\":\"Facility reports AHD/OI indicators to district/national programme and uses feedback for site-level action.\",\"row\":142,\"parent\":false},{\"k\":\"q16_1\",\"no\":\"16.1\",\"d\":\"16\",\"p\":\"P1\",\"q\":\"All relevant staff are oriented to AHD definition, entry-point screening, triage danger signs, CD4 interpretation, WHO staging and same-day package flow.\",\"row\":143,\"parent\":false},{\"k\":\"q16_2\",\"no\":\"16.2\",\"d\":\"16\",\"p\":\"P1\",\"q\":\"Clinicians and nurses are trained in TB screening, LF-LAM, GeneXpert/low-complexity automated NAAT and N-POC/NPOC-NAAT pathways, CrAg screening, meningitis recognition, ART timing and referral criteria.\",\"row\":144,\"parent\":false},{\"k\":\"q16_3\",\"no\":\"16.3\",\"d\":\"16\",\"p\":\"P2\",\"q\":\"Laboratory staff are trained in specimen handling, point-of-care test quality assurance, result documentation and rapid communication of positive/critical results.\",\"row\":145,\"parent\":false},{\"k\":\"q16_4\",\"no\":\"16.4\",\"d\":\"16\",\"p\":\"P2\",\"q\":\"Pharmacy staff are trained in AHD commodity management, drug interactions, synchronized dispensing and missed pickup alerts.\",\"row\":146,\"parent\":false},{\"k\":\"q16_5\",\"no\":\"16.5\",\"d\":\"16\",\"p\":\"P2\",\"q\":\"Pediatric/maternity/community staff are trained in child/adolescent AHD criteria, caregiver counselling, PMTCT linkage and family-centered follow-up.\",\"row\":147,\"parent\":false},{\"k\":\"q16_6\",\"no\":\"16.6\",\"d\":\"16\",\"p\":\"P2\",\"q\":\"Updated job aids, algorithms, referral contacts and escalation pathways are visible in triage, consultation rooms, laboratory, pharmacy and inpatient wards.\",\"row\":148,\"parent\":false},{\"k\":\"q16_7\",\"no\":\"16.7\",\"d\":\"16\",\"p\":\"P3\",\"q\":\"Supervision includes direct observation, case review, data review and refresher mentoring after guideline or supply-chain changes.\",\"row\":149,\"parent\":false}]},{\"type\":\"matrix\",\"title\":\"Staff Training and Competency Matrix\",\"note\":\"Enter the number of staff trained by cadre/role and by AHD topic. Trainings can be in-person or virtual, conducted at site, regional or central levels.\",\"topics\":[{\"k\":\"t1\",\"label\":\"AHD definition & CD4 staging\"},{\"k\":\"t2\",\"label\":\"TB screen / LF-LAM / GeneXpert / N-POC\"},{\"k\":\"t3\",\"label\":\"CrAg / meningitis pathway\"},{\"k\":\"t4\",\"label\":\"ART timing & adherence\"},{\"k\":\"t5\",\"label\":\"Pediatric AHD\"},{\"k\":\"t6\",\"label\":\"Discharge / follow-up\"}],\"dateLabel\":\"Date refreshed\",\"rowHeader\":\"Cadre / role\",\"cadres\":[{\"k\":\"c1\",\"label\":\"Clinician / medical doctor\"},{\"k\":\"c2\",\"label\":\"Nurse / midwife\"},{\"k\":\"c3\",\"label\":\"APS / peer supporter\"},{\"k\":\"c4\",\"label\":\"Laboratory staff\"},{\"k\":\"c5\",\"label\":\"Pharmacist / dispenser\"},{\"k\":\"c6\",\"label\":\"Data Clerk / ACRR\"},{\"k\":\"c7\",\"label\":\"Community health worker\"},{\"k\":\"c8\",\"label\":\"Facility manager / QI lead\"}],\"options\":[\"Yes\",\"Partial\",\"No\"]},{\"type\":\"actions\",\"title\":\"Priority Action Plan\",\"note\":\"Automatically lists every Partial or No finding from the main Checklist\",\"auto\":[\"Gap #\",\"Item no.\",\"Domain\",\"Condition\",\"Pr.\",\"Current response\",\"Finding / gap\",\"Evidence / notes\",\"Suggested target date\"],\"user\":[\"Corrective action\",\"Person responsible\",\"Due date\"]}],\"scoring\":{\"ready\":\"Yes\",\"partial\":\"Partial\",\"no\":\"No\",\"na\":\"N/A\",\"bands\":[{\"min\":90,\"label\":\"Ready\",\"c\":\"green\"},{\"min\":80,\"label\":\"Substantially ready\",\"c\":\"yellow\"},{\"min\":60,\"label\":\"Partially ready\",\"c\":\"amber\"},{\"min\":0,\"label\":\"Critical readiness gap\",\"c\":\"red\"}],\"p1Override\":true,\"days\":{\"P1\":30,\"P2\":90,\"P3\":180}},\"tiers\":[{\"t\":\"Tier 1\",\"min\":2000},{\"t\":\"Tier 2\",\"min\":1000},{\"t\":\"Tier 3\",\"min\":500},{\"t\":\"Tier 4\",\"min\":0}]}";

function publishAHD(){
  var r = publishForm({
    id:'AHD-FY27',
    title:'AHD Site Readiness Assessment',
    subtitle:'Facility profile, 141 readiness responses, staff training and action plan',
    status:'OPEN',
    scope:'SITE',
    /* the coordinators and the facility focal points, as agreed */
    fillers:'SUPERVISOR,SITE',
    closes:'',
    version:1,
    by:'console',
    layout:JSON.parse(AHD_LAYOUT)
  });
  Logger.log(JSON.stringify(r));
  return r;
}
function closeAHD(){
  return publishForm({id:'AHD-FY27', title:'AHD Site Readiness Assessment',
    status:'CLOSED', layout:JSON.parse(AHD_LAYOUT)});
}
function archiveAHD(){
  return publishForm({id:'AHD-FY27', title:'AHD Site Readiness Assessment',
    status:'ARCHIVED', layout:JSON.parse(AHD_LAYOUT)});
}
