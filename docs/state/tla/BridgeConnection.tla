-------------------- MODULE BridgeConnection --------------------
EXTENDS Naturals, FiniteSets
VARIABLES phase, pending, sent, publications
vars == <<phase, pending, sent, publications>>
Init == /\ phase = "Idle" /\ pending = FALSE /\ sent = {} /\ publications = {}
Begin == /\ phase = "Idle" /\ phase' = "Connecting" /\ pending' = TRUE
         /\ UNCHANGED <<sent, publications>>
Accept == /\ pending /\ phase = "Connecting"
          /\ LET delivered == sent \cup {"initialized"}
             IN /\ sent' = delivered
                /\ publications' = publications \cup {[before |-> phase, initialized |-> "initialized" \in delivered]}
          /\ phase' = "Connected" /\ pending' = FALSE
Fail == /\ phase = "Connecting" /\ phase' = "Failed" /\ pending' = FALSE
        /\ UNCHANGED <<sent, publications>>
Teardown == /\ phase \in {"Idle", "Connecting", "Connected"}
            /\ phase' = "TearingDown" /\ UNCHANGED <<pending, sent, publications>>
HandlersSettle == /\ phase = "TearingDown" /\ phase' = "TornDown"
                 /\ UNCHANGED <<pending, sent, publications>>
Close == /\ phase # "Closed" /\ phase' = "Closed"
         /\ UNCHANGED <<pending, sent, publications>>
Next == Begin \/ Accept \/ Fail \/ Teardown \/ HandlersSettle \/ Close
Spec == Init /\ [][Next]_vars
InitializedBeforePublication == \A p \in publications : p.initialized
NoLateRevival == \A p \in publications : p.before = "Connecting"
=================================================================
