const ipc = require('electron').ipcRenderer;
const {remote, dialog, shell} = require('electron');
const fs = require("fs");
const crypto = require("crypto");
const {app} = require("electron").remote;
const path = require("path");


var currentWindowIdentifier = null; // the window id of the widnow this renderer is shown in
var currentOpenFilePathString = null;
var _isOpeningInNewWindow = false;

// initialise the markdown editor
var editor = new tui.Editor({
    el: document.querySelector('#editSection'),
    initialEditType: 'wysiwyg',
    previewStyle: 'vertical',
    height: '100%',
    useCommandShortcut: false, // can be reenabled later once the cmd+s and other os spesific keys dont prevent the proper app hotkey
    exts: ['table'],
    hooks: {
        previewBeforeHook: function(html) { return changeHTMLForPreviewTab(html); },
      }
});

// Chck if an update is available
check_for_update();

///////////////////////////////////////////////////
// START: Check the licence dont put this into a seperate function as the function name would be visible even if obfuscated
///////////////////////////////////////////////////


function activateDemoMode() {
    alert("The licence could not be verified. In demo mode you can not save files.");
    ipc.send("licence-setup-demo-mode");
}

function verifyLicence(licenceKey, licenceCertificate) {
    console.log("Checking the licence key: "+licenceKey+" against this licence certificate: "+licenceCertificate);
    // TODO: Remove this function name - the name is visible also in obfuscated files
    function commonDRMisLicenceValid(licenceCertificate, scriptName, scriptVersion, scriptSecret) {
        var hash = crypto.createHash("sha1");
        let concatstring = scriptName+'::'+scriptVersion+'::'+scriptSecret;
        hash.update(concatstring);
        let expectedLicenceCertificateHash = hash.digest("hex");
        console.log("calculated expected hash hex: "+expectedLicenceCertificateHash)
        console.log("licence certificate is: "+licenceCertificate);
         if (licenceCertificate == expectedLicenceCertificateHash) {
            return true;
        }
    
        return false;
    }

    // TODO: Remove this function name - the name is visible also in obfuscated files
    function isLicenceOK(licenceKey, licenceCertificate, machinedata) {
        let scriptName = "PMKundenAPILicenceServer";
        let scriptVersion = "1";
        let scriptSecret=licenceKey + "::" + machinedata;
        return commonDRMisLicenceValid(licenceCertificate, scriptName, scriptVersion, scriptSecret);
    }
   
    // Read the data (cant be in a sepeate function as it could be overwritten even if obfuscated easily then)
    var wmi = require('node-wmi');
    wmi.Query(
        {
            class: 'Win32_BIOS'
        }, function(err, bios) {
            //console.log(bios);

            if (err) {
                console.log("Could not get hardware serial.");
                activateDemoMode();
                return
            }

            var machinedata = bios[0]["Manufacturer"]+"."+bios[0]["SerialNumber"];
    
            var shasum = crypto.createHash('sha1');
            shasum.update(machinedata);
            var machinedatahash = shasum.digest('hex')
    
            console.log("using this machinedata: "+machinedata)
            console.log("hashed machine data: ", machinedatahash)
                
            // comparing the licences
            
            if (!isLicenceOK(licenceKey, licenceCertificate, machinedatahash)) {
                //alert("Invalid licence");
                activateDemoMode();
            }
            else {
                //alert("Valid licence");
                console.log("Valid licence detected.");
            }
        }
    );
}

const pathToLicenceDirectory = path.dirname(app.getPath("exe"))+"/LICENCEDATA";
const pathToLicenceFile = pathToLicenceDirectory+"/key.txt";
const pathToLicenceCertificteFile = pathToLicenceDirectory+"/certificate.txt";
if (fs.existsSync(pathToLicenceFile) && fs.existsSync(pathToLicenceCertificteFile)) {
    let licenceKey = fs.readFileSync(pathToLicenceFile);
    let licenceCertificate = fs.readFileSync(pathToLicenceCertificteFile);

    console.log("Verifying licence now");
    verifyLicence(licenceKey, licenceCertificate);
} else {
    activateDemoMode();
    shell.openExternal("LicenceClient/Licence Client.exe");
}


///////////////////////////////////////////////////
// END: licence check
///////////////////////////////////////////////////


// Start: prevent links written in Markdown to fuck up the app instaed open in external browser
function changeHTMLForPreviewTab(html) {
    return html;
}

    // open links externally by default if they are displayed in the preview of the markdown editor tab (wuold fuck up the app if we didnt do this)
    $(document).on('click', '.te-preview a', function(event) {
        event.preventDefault();
        shell.openExternal(this.href);
});
// End

ipc.on('open_file_at_path', function(event, message) {
    var userWorkedHere = didUserWorkHere();
    if (!userWorkedHere) {
        var pathString = message;
        console.log("Opening file from path: "+pathString);
        helper_file_open(pathString)
    }
    else {
        alert("user already worked here");
    }
});

ipc.on('action', function(event, message) {
    console.log("UI incomming IPC: "+message);

    switch(message) {
        case "file.open":
            handle_action_file_open();
            break;
        
        case "file.save":
            appmenu_file_save();
            break;

        case "file.save_as":
            appmenu_file_save_as();
            break;

        case "app-window-about-to-close":
            handle_window_about_to_close();
            break;

        case "user-confirmed-save-before-close":
            handle_user_confirmed_save_before_close();
            break;

        case "file.export.html":
            handle_export_html();
            break;

        default:
            break;
    }
});

ipc.on('apply_window_id_for_ipc', function(event, message) {
    console.log("apply_window_id_for_ipc: "+message);
    currentWindowIdentifier = message;
});

function send_to_main_close_window_with_confirm() {
    ipc.send("close-window-with-confirm", currentWindowIdentifier);
}

function send_to_main_close_window_without_confirm() {
    ipc.send("close-window-without-confirm", currentWindowIdentifier);
}

function handle_window_about_to_close() {
    if (should_show_close_confirmation()) { // check if there is stuff to save
        send_to_main_close_window_with_confirm();
    }
    else {
        send_to_main_close_window_without_confirm();
    }
}

function handle_user_confirmed_save_before_close() {
    var success = appmenu_file_save();

    if (success) { // check for success - user might have canceled the saving dialog which wuld result in a 'failure' namely the file not beeing saved
        send_to_main_close_window_without_confirm();
    }
}

function should_show_close_confirmation() {
    var userWorkedHere = didUserWorkHere();
    if (!userWorkedHere) {
        // nothing to save - close window
        return false;
    }
    return true;
}

function didUserWorkHere() {
    // returns true if the user worked alredy and some changes might be unsaved otherwise returnes false
    return editor.getMarkdown().toString().trim().length !== 0;
}

function handle_action_file_open() {
    // open file if user did not work in this window otherwise open new window (tell main process)
    var userWorkedHere = didUserWorkHere();
    if (userWorkedHere) {
        // tell main process to open new window with the path
        _isOpeningInNewWindow = true;
        ipc.send('open-file-dialog');
        ipc.on('selected-directory', function (event, path) {
            _isOpeningInNewWindow = false;
            ipc.send("action.file.open.inNewWindow", `${path}`)
        })
    }
    else {
        // open file in this editor window
        appmenu_file_open();
    }
}

function helper_file_open(pathString) {
    currentOpenFilePathString = pathString;
    var data = fs.readFileSync(pathString);
    editor.setMarkdown(data.toString());
}

function appmenu_file_open() {
    ipc.send('open-file-dialog')

    ipc.on('selected-directory', function (event, path) {
        if (!_isOpeningInNewWindow) {
            helper_file_open(`${path}`)
        }
    })
}

function handle_export_html() {
    alert("not yet implemented");
}

function appmenu_helper_save_file_at(pathString) {
    console.log('Saving file at: '+pathString);

    // if the user did not provide a file extention he wants to use we will use a default one (.md is quite common).
    // we need to do this since the app currently does not support opening a file without file extention which would 
    // result in the user saving but not ever beeing able to open his work which wuold be bad
    var userDidNotProvideFileExtention = pathString.split(".").length == 1;
    if (userDidNotProvideFileExtention) {
        pathString = pathString+".md";
    }
    currentOpenFilePathString = pathString;
    var data = editor.getMarkdown();
    fs.writeFileSync(pathString, data);
    return true; // for now jsut always return success
}

function appmenu_file_save_as() {
    ipc.send('save-dialog')

    ipc.on('saved-file', function (event, path) {
        if (path) {
            return appmenu_helper_save_file_at(`${path}`)
        }
        else {
            // user canceled the saving dialog
            return false;
        }
    })
}

function appmenu_file_save() {
    if (!currentOpenFilePathString) {
        return appmenu_file_save_as();
    }
    else {
        return appmenu_helper_save_file_at(currentOpenFilePathString);
    }
}


// Start:Check update

function check_for_update() {
    $.jsonrpc({
        url: "https://philipp-mayr.de/kunden/api/update.py",
        method: 'updateAviable',
        params: {appId: 'PM Markdown Editor', versionId: '1.0.0'}
    }).done(function(result) {
        if (result === true) {
            // an update is available
            ipc.send("update.available.notifyuser", "https://www.philipp-mayr.de/apps/markdown-editor/")
        }
    }).fail(function(error) {
        console.info('jsonrpc2: code:', error.code);
        console.info('jsonrpc2: message:', error.message);
        console.info(error.data);
    });
}

// End: Check update
