import { Action, ActionPanel, confirmAlert, Form, Icon, showToast, Toast, getPreferenceValues } from "@raycast/api";
import { exec } from "child_process";
import { useEffect, useState } from "react";

interface Preferences {
  useSudo: boolean;
}

const actions = {
  Finder: "Finder",
  Dock: "Dock",
  "SystemUIServer (e.g. Menu Bar)": "SystemUIServer",
  Audio: "coreaudiod",
  Bluetooth: "bluetoothd",
  WindowServer: "-HUP WindowServer",
};

const warnings: Partial<Record<keyof typeof actions, string>> = {
  WindowServer: "This will close all open applications and log you out.",
};

const dropdownItems = Object.keys(actions).map((key) => {
  return <Form.Dropdown.Item key={key} value={key} title={key} />;
});

function getAdvancedDropdown() {
  return new Promise<Element[]>((resolve, reject) => {
    exec("launchctl list | grep com.apple | awk '{print $3}'\n", (error, stdout) => {
      if (error) {
        console.error(`exec error: ${error}`);
        reject(error); // Reject the promise on error
        return;
      }

      const services = stdout.split("\n").map((line) => line.trim());

      const items = services.map((service) => <Form.Dropdown.Item key={service} value={service} title={service} />);

      resolve(items); // Resolve the promise with the updated items
    });
  });
}

async function getExePath(exe: string) {
  const path = await new Promise((resolve) => {
    exec(`which ${exe}`, (error, stdout) => {
      resolve(error ? null : stdout.trim());
    });
  });

  if (path) {
    return path;
  }

  // test a few common locations
  const locations = [`/usr/bin/${exe}`, `/bin/${exe}`, `/usr/sbin/${exe}`, `/sbin/${exe}`];
  for (const loc of locations) {
    if (
      await new Promise((resolve) => {
        exec(`type ${loc}`, (error) => {
          resolve(!error);
        });
      })
    ) {
      return loc;
    }
  }

  return null;
}

export default function Command() {
  const [dropdown, setDropdown] = useState<Element[] | null>(null);
  const [advancedMode, setAdvancedMode] = useState(false);

  // initialise dropdown based on advanced mode
  useEffect(() => {
    (async () => {
      if (!advancedMode) {
        setDropdown(dropdownItems);
      } else {
        setDropdown(await getAdvancedDropdown());
      }
    })();
  }, [advancedMode]);

  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Restart Process"
            onSubmit={async (values) => {
              await performAction(values);
            }}
          />
        </ActionPanel>
      }
    >
      <Form.Dropdown id="name" title="Process">
        {dropdown}
      </Form.Dropdown>
      <Form.Separator />
      <Form.Checkbox
        label="Advanced Mode"
        value={advancedMode}
        id="advancedMode"
        onChange={setAdvancedMode}
        info="Displays a list of all currently running system daemons. Only enable if you know what you're doing."
      />
    </Form>
  );
}

async function performAction(values: { name: string; advancedMode: boolean }) {
  const sudoOption = getPreferenceValues<Preferences>().useSudo;
  const advancedMode = values?.advancedMode,
    name = values?.name,
    action = advancedMode ? name : actions[name],
    sudo = sudoOption ? "sudo" : "";
  let cmd = "";

  if (!action) {
    await showToast(Toast.Style.Failure, "No process selected");
    return;
  }

  await showToast(Toast.Style.Animated, `Restarting ${name}...`);

  if (!advancedMode) {
    if (warnings[name]) {
      let userConfirmed = false;
      await confirmAlert({
        title: "Warning",
        message: warnings[name],
        icon: Icon.Warning,
        primaryAction: {
          title: "Continue",
          style: Action.Style.Destructive,
          onAction: () => {
            userConfirmed = true;
          },
        },
      });
      if (!userConfirmed) return;
    }

    const killall = await getExePath("killall");
    if (!killall) {
      await showToast(Toast.Style.Failure, "killall executable not found");
      return;
    }
    cmd = `${sudo} ${killall} -KILL ${action}`;
  } else {
    const launchctl = await getExePath("launchctl");
    if (!launchctl) {
      await showToast(Toast.Style.Failure, "launchctl executable not found");
      return;
    }
    cmd = `${sudo} ${launchctl} stop ${action}`;
  }

  let success = true;

  const child = exec(cmd, (error, stdout, stderr) => {
    if (error) {
      console.log(`exec error: ${error}`);
      showToast(Toast.Style.Failure, `Error: ${error.message}`);
      success = false;
    }
    if (stderr) {
      console.log(`stderr: ${stderr}`);
    }
    if (stdout) {
      console.log(`stdout: ${stdout}`);
    }
  });

  // return only after the process has finished
  await new Promise((resolve) => {
    child.on("exit", resolve);
  });

  await new Promise((resolve) => {
    setTimeout(resolve, 5);
  });

  if (success) {
    await showToast(Toast.Style.Success, `${name} restarted`);
  }
}